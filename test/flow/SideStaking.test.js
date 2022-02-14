/* eslint-env mocha */
/* global artifacts, contract, web3, it, beforeEach */
const hre = require("hardhat");
const { assert, expect, should, be } = require("chai");
const {
  expectRevert,
  expectEvent,
  time,
} = require("@openzeppelin/test-helpers");

const BN = require("bn.js");

const { impersonate } = require("../helpers/impersonate");
const { getEventFromTx } = require("../helpers/utils");
const constants = require("../helpers/constants");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { keccak256 } = require("@ethersproject/keccak256");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const ether = require("@openzeppelin/test-helpers/src/ether");
const ethers = hre.ethers;

describe("1SS flow", () => {
  let metadata,
    tokenERC721,
    tokenAddress,
    data,
    flags,
    factoryERC721,
    factoryERC20,
    templateERC721,
    templateERC20,
    erc20Token,
    erc20Token2,
    oceanContract,
    daiContract,
    sideStaking,
    router,
    poolTemplate,
    bPoolAddress,
    bPool,
    signer,
    dtIndex = null,
    oceanIndex = null,
    daiIndex = null,
    cap = web3.utils.toWei("100000");

  const communityFeeCollector = "0xeE9300b7961e0a01d9f0adb863C7A227A07AaD75";
  const provider = new ethers.providers.JsonRpcProvider();

  before("init contracts for each test", async () => {
    const ERC721Template = await ethers.getContractFactory("ERC721Template");
    const ERC20Template = await ethers.getContractFactory("ERC20Template");
    const ERC721Factory = await ethers.getContractFactory("ERC721Factory");

    const Router = await ethers.getContractFactory("FactoryRouter");
    const SSContract = await ethers.getContractFactory("SideStaking");
    const BPool = await ethers.getContractFactory("BPool");
    const MockERC20 = await ethers.getContractFactory('MockERC20Decimals');
    console.log(await provider.getBlockNumber());

    [
      owner, // nft owner, 721 deployer
      reciever,
      user2, // 721Contract manager
      user3, // pool creator and liquidity provider
      user4,
      user5,
      user6,
      marketFeeCollector,
      newMarketFeeCollector,
      pool2MarketFeeCollector,
      opcCollector,
    ] = await ethers.getSigners();

      // MOCK TOKENS
      oceanContract = await MockERC20.deploy(
        'OCEAN','OCEAN',18
      );
      daiContract = await MockERC20.deploy(
        'DAI','DAI',18
      );
      
  
  
      await oceanContract
        .transfer(user3.address, ethers.utils.parseEther("10000"));
        
        await oceanContract
        .transfer(user4.address, ethers.utils.parseEther("10000"));
  
  
  
      await daiContract
        .transfer(user3.address, ethers.utils.parseEther("10000"));
        await daiContract
        .transfer(user4.address, ethers.utils.parseEther("10000"));
  
  

    data = web3.utils.asciiToHex("SomeData");
    flags = web3.utils.asciiToHex(constants.blob[0]);

    poolTemplate = await BPool.deploy();

    // DEPLOY ROUTER, SETTING OWNER
    router = await Router.deploy(
      owner.address,
      oceanContract.address,
      poolTemplate.address, // pooltemplate field, unused in this test
      opcCollector.address,
      []
    );

    sideStaking = await SSContract.deploy(router.address);

    templateERC20 = await ERC20Template.deploy();

    // SETUP ERC721 Factory with template
    templateERC721 = await ERC721Template.deploy();
    factoryERC721 = await ERC721Factory.deploy(
      templateERC721.address,
      templateERC20.address,
      communityFeeCollector,
      router.address
    );

    // SET REQUIRED ADDRESS
    await router.addFactory(factoryERC721.address);

    await router.addSSContract(sideStaking.address);
  });
  const swapFee = 1e15;
  const swapMarketFee = 1e15;
  const vestedBlocks = 2500000;
  
  it("#getId - should return templateID", async () => {
    const templateId = 1;
    assert((await sideStaking.getId()) == templateId);
  });
  
  it("#1 - owner deploys a new ERC721 Contract", async () => {
    // by default connect() in ethers goes with the first address (owner in this case)
    const tx = await factoryERC721.deployERC721Contract(
      "NFT",
      "NFTSYMBOL",
      1,
      "0x0000000000000000000000000000000000000000",
      "0x0000000000000000000000000000000000000000",
      "https://oceanprotocol.com/nft/"
    );
    const txReceipt = await tx.wait();
    const event = getEventFromTx(txReceipt, "NFTCreated");
    assert(event, "Cannot find NFTCreated event");
    tokenAddress = event.args[0];

    tokenERC721 = await ethers.getContractAt("ERC721Template", tokenAddress);

    assert((await tokenERC721.balanceOf(owner.address)) == 1);
  });

  it("#2 - owner adds user2 as manager, which then adds user3 as store updater, metadata updater and erc20 deployer", async () => {
    await tokenERC721.addManager(user2.address);
    await tokenERC721.connect(user2).addTo725StoreList(user3.address);
    await tokenERC721.connect(user2).addToCreateERC20List(user3.address);
    await tokenERC721.connect(user2).addToMetadataList(user3.address);

    assert((await tokenERC721.getPermissions(user3.address)).store == true);
    assert(
      (await tokenERC721.getPermissions(user3.address)).deployERC20 == true
    );
    assert(
      (await tokenERC721.getPermissions(user3.address)).updateMetadata == true
    );
  });

  it("#3 - user3 deploys a new erc20DT, assigning himself as minter", async () => {
    const trxERC20 = await tokenERC721
      .connect(user3)
      .createERC20(
        1,
        ["ERC20DT1", "ERC20DT1Symbol"],
        [
          user3.address,
          user6.address,
          user3.address,
          "0x0000000000000000000000000000000000000000",
        ],
        [cap, 0],
        []
      );
    const trxReceiptERC20 = await trxERC20.wait();
    const event = getEventFromTx(trxReceiptERC20, "TokenCreated");
    assert(event, "Cannot find TokenCreated event");
    erc20Address = event.args[0];

    erc20Token = await ethers.getContractAt("ERC20Template", erc20Address);
    assert((await erc20Token.permissions(user3.address)).minter == true);
  });

  it("#4 - user3 calls deployPool() and check ocean and market fee", async () => {
    const ssDTBalance = await erc20Token.balanceOf(sideStaking.address);

    const initialOceanLiquidity = web3.utils.toWei("2000");
    const initialDTLiquidity = initialOceanLiquidity;
    // approve exact amount
    await oceanContract
      .connect(user3)
      .approve(router.address, web3.utils.toWei("2000"));

    // we deploy a new pool with burnInEndBlock as 0
    // we deploy a new pool
    receipt = await (
      await erc20Token.connect(user3).deployPool(
        //  sideStaking.address,
        // oceanContract.address,
        [
          web3.utils.toWei("1"), // rate
          18, // baseTokenDecimals
          web3.utils.toWei("10000"), //vestingAmount max 10% of total cap
          vestedBlocks, // vested blocks
          initialOceanLiquidity, // baseToken initial pool liquidity
        ],
        // user3.address,
        [
          swapFee, //
          swapMarketFee,
        ],
        // marketFeeCollector.address,
        //  user3.address// publisher address (vested token)
        [
          sideStaking.address,
          oceanContract.address,
          user3.address,
          user3.address,
          marketFeeCollector.address,
          poolTemplate.address,
        ]
      )
    ).wait();
    const initialBlockNum = await ethers.provider.getBlockNumber();
    //console.log(receipt)
    const PoolEvent = receipt.events.filter((e) => e.event === "NewPool");
    // console.log(PoolEvent[0].args)

    assert(PoolEvent[0].args.ssContract == sideStaking.address);

    bPoolAddress = PoolEvent[0].args.poolAddress;

    bPool = await ethers.getContractAt("BPool", bPoolAddress);

    assert((await bPool.isFinalized()) == true);

    expect(await erc20Token.balanceOf(sideStaking.address)).to.equal(
      web3.utils.toWei("98000")
    );

    expect(await bPool.getOPCFee()).to.equal(0);
    expect(await bPool._swapPublishMarketFee()).to.equal(swapMarketFee);

    expect(await bPool.communityFees(oceanContract.address)).to.equal(0);
    expect(await bPool.communityFees(erc20Token.address)).to.equal(0);
    expect(await bPool.publishMarketFees(oceanContract.address)).to.equal(0);
    expect(await bPool.publishMarketFees(erc20Token.address)).to.equal(0);
    // we should have a circulating supply of 2k  (100k cap  - 98k ss balance - 2k in pool = 0)
    expect(
      await sideStaking.getDatatokenCirculatingSupply(erc20Token.address)
    ).to.equal(web3.utils.toWei("2000"),'getDatatokenCirculatingSupply missmatch');
    expect(
      await sideStaking.getDatatokenCurrentCirculatingSupply(erc20Token.address)
    ).to.equal(initialDTLiquidity);
    expect(await sideStaking.getBaseTokenAddress(erc20Token.address)).to.equal(
      oceanContract.address
    );
    expect(await sideStaking.getPoolAddress(erc20Token.address)).to.equal(
      bPoolAddress
    );
    expect(await sideStaking.getPublisherAddress(erc20Token.address)).to.equal(
      user3.address
    );
    expect(await sideStaking.getBaseTokenBalance(oceanContract.address)).to.equal(0);
    expect(await sideStaking.getDatatokenBalance(erc20Token.address)).to.equal(
      web3.utils.toWei("98000")
    );
    expect(
      await sideStaking.getvestingAmountSoFar(erc20Token.address)
    ).to.equal(0);
    expect(await sideStaking.getvestingAmount(erc20Token.address)).to.equal(
      web3.utils.toWei("10000")
    );
    expect(await sideStaking.getvestingLastBlock(erc20Token.address)).to.equal(
      initialBlockNum
    );
    expect(await sideStaking.getvestingEndBlock(erc20Token.address)).to.equal(
      initialBlockNum + vestedBlocks
    );

    const deployedPools = await erc20Token.getPools()
      assert(deployedPools.includes(web3.utils.toChecksumAddress(bPoolAddress)), "Pool not found in erc20Token.getPools()")
  });

  it("#5 - user3 fails to mints new erc20 tokens even if it's minter", async () => {
    assert((await erc20Token.permissions(user3.address)).minter == true);

    await expectRevert(
      erc20Token.connect(user3).mint(user3.address, web3.utils.toWei("10000")),
      "DatatokenTemplate: cap exceeded"
    );

    assert((await erc20Token.balanceOf(user3.address)) == 0);
  });

  it("#getId - should return templateID", async () => {
    const templateId = 1;
    assert((await bPool.getId()) == templateId);
  });
  
  it("#6 - user4 buys some DT after burnIn period- exactAmountIn", async () => {
    // pool has initial ocean tokens at the beginning
    assert(
      (await oceanContract.balanceOf(bPoolAddress)) == web3.utils.toWei("2000")
    );

    // we approve the pool to move Ocean tokens
    await oceanContract
      .connect(user4)
      .approve(bPoolAddress, web3.utils.toWei("10000"));

    // user4 has no DT before swap
    assert((await erc20Token.balanceOf(user4.address)) == 0);
    // we prepare the arrays, user5 is going to receive the dynamic market fee
    amountIn = web3.utils.toWei("10");
    minAmountOut = web3.utils.toWei("1");
    maxPrice = web3.utils.toWei("10");
    marketFee = 0;
    const tokenInOutMarket = [oceanContract.address, erc20Token.address, user5.address]; // [tokenIn,tokenOut,marketFeeAddress]
    const amountsInOutMaxFee = [amountIn, minAmountOut, maxPrice, marketFee]; // [exactAmountIn,minAmountOut,maxPrice,_swapMarketFee]

    await bPool
      .connect(user4)
      .swapExactAmountIn(tokenInOutMarket, amountsInOutMaxFee);

    // user4 got his DT
    assert((await erc20Token.balanceOf(user4.address)) > 0);
  });

  it("#7 - user4 buys some DT after burnIn period - exactAmountOut", async () => {
    // we already approved pool to withdraw Ocean tokens

    // user only has DT from previous test
    const user4DTbalance = await erc20Token.balanceOf(user4.address);
    console.log(user4DTbalance.toString());

    // we prepare the arrays, user5 is going to receive the dynamic market fee
    maxAmountIn = web3.utils.toWei("100");
    amountOut = web3.utils.toWei("10");
    maxPrice = web3.utils.toWei("10");
    marketFee = 0;
    const tokenInOutMarket = [oceanContract.address, erc20Token.address, user5.address]; // [tokenIn,tokenOut,marketFeeAddress]
    const amountsInOutMaxFee = [maxAmountIn, amountOut, maxPrice, marketFee]; // [maxAmountIn,exactAmountOut,maxPrice,_swapMarketFee]

    await bPool
      .connect(user4)
      .swapExactAmountOut(tokenInOutMarket, amountsInOutMaxFee);

    // user4 got his DT
    console.log((await erc20Token.balanceOf(user4.address)).toString());
    assert(
      parseInt(await erc20Token.balanceOf(user4.address)) >
        parseInt(user4DTbalance)
    );
  });

  it("#8 - user4 swaps some DT back to Ocean swapExactAmountIn", async () => {
    assert((await bPool.isFinalized()) == true);

    await erc20Token
      .connect(user4)
      .approve(bPoolAddress, web3.utils.toWei("10000000"));

    const user4DTbalance = await erc20Token.balanceOf(user4.address);

    const user4Oceanbalance = await oceanContract.balanceOf(user4.address);
    // we prepare the arrays, user5 is going to receive the dynamic market fee
    amountIn = web3.utils.toWei("10");
    minAmountOut = web3.utils.toWei("1");
    maxPrice = web3.utils.toWei("10");
    marketFee = 0;
    const tokenInOutMarket = [erc20Token.address, oceanContract.address, user5.address]; // [tokenIn,tokenOut,marketFeeAddress]
    const amountsInOutMaxFee = [amountIn, minAmountOut, maxPrice, marketFee]; // [exactAmountIn,minAmountOut,maxPrice,_swapMarketFee]

    receipt = await (
      await bPool
        .connect(user4)
        .swapExactAmountIn(tokenInOutMarket, amountsInOutMaxFee)
    ).wait();

    const SwapEvent = receipt.events.filter((e) => e.event === "LOG_SWAP");

    //console.log(SwapEvent)
    assert(
      parseInt(await erc20Token.balanceOf(user4.address)) <
        parseInt(user4DTbalance)
    );
    assert(
      parseInt(await oceanContract.balanceOf(user4.address)) >
        parseInt(user4Oceanbalance)
    );
  });

  it("#9 - user4 adds more liquidity with joinPool() (adding both tokens)", async () => {
    const user4DTbalance = await erc20Token.balanceOf(user4.address);
    const user4Oceanbalance = await oceanContract.balanceOf(user4.address);
    const user4BPTbalance = await bPool.balanceOf(user4.address);
    const ssContractDTbalance = await erc20Token.balanceOf(sideStaking.address);
    const ssContractBPTbalance = await bPool.balanceOf(sideStaking.address);

    const BPTAmountOut = web3.utils.toWei("0.01");
    const maxAmountsIn = [
      web3.utils.toWei("50"), // Amounts IN
      web3.utils.toWei("50"), // Amounts IN
    ];
    await oceanContract
      .connect(user4)
      .approve(bPool.address, web3.utils.toWei("50"));

    await erc20Token
      .connect(user4)
      .approve(bPool.address, web3.utils.toWei("50"));

    receipt = await (
      await bPool.connect(user4).joinPool(
        BPTAmountOut, // exactBPT OUT token OUT
        maxAmountsIn
      )
    ).wait();

    const JoinEvent = receipt.events.filter((e) => e.event === "LOG_JOIN");
    expect(JoinEvent[0].args.tokenIn).to.equal(erc20Token.address);
    expect(JoinEvent[1].args.tokenIn).to.equal(oceanContract.address);

    // we check all balances
    expect(
      JoinEvent[0].args.tokenAmountIn.add(
        await erc20Token.balanceOf(user4.address)
      )
    ).to.equal(user4DTbalance);
    expect(
      JoinEvent[1].args.tokenAmountIn.add(
        await oceanContract.balanceOf(user4.address)
      )
    ).to.equal(user4Oceanbalance);

    expect(user4BPTbalance.add(BPTAmountOut)).to.equal(
      await bPool.balanceOf(user4.address)
    );

    // NOW we check the ssContract BPT and DT balance didn't change.
    expect(ssContractBPTbalance).to.equal(
      await bPool.balanceOf(sideStaking.address)
    );

    expect(ssContractDTbalance).to.equal(
      await erc20Token.balanceOf(sideStaking.address)
    );
  });

  it("#10 - user3 adds more liquidity with joinswapExternAmountIn (only OCEAN)", async () => {
    const user3DTbalance = await erc20Token.balanceOf(user3.address);
    const user3Oceanbalance = await oceanContract.balanceOf(user3.address);
    const ssContractDTbalance = await erc20Token.balanceOf(sideStaking.address);
    const ssContractBPTbalance = await bPool.balanceOf(sideStaking.address);

    await oceanContract
      .connect(user3)
      .approve(bPool.address, web3.utils.toWei("100"));

    const oceanAmountIn = web3.utils.toWei("100");
    const minBPTOut = web3.utils.toWei("0.1");

    receipt = await (
      await bPool.connect(user3).joinswapExternAmountIn(
        oceanAmountIn, // amount In (ocean tokens)
        minBPTOut // BPT token out
      )
    ).wait();

    const JoinEvent = receipt.events.filter((e) => e.event === "LOG_JOIN");

    expect(JoinEvent[0].args.tokenIn).to.equal(oceanContract.address);

    expect(JoinEvent[0].args.tokenAmountIn).to.equal(oceanAmountIn);

    expect(JoinEvent[1].args.tokenIn).to.equal(erc20Token.address);

    const sideStakingAmountIn = ssContractDTbalance.sub(
      await erc20Token.balanceOf(sideStaking.address)
    );

    expect(JoinEvent[1].args.tokenAmountIn).to.equal(sideStakingAmountIn);

    // we check ssContract actually moved DT and got back BPT
    expect(ssContractDTbalance.sub(JoinEvent[1].args.tokenAmountIn)).to.equal(
      await erc20Token.balanceOf(sideStaking.address)
    );

    expect(ssContractDTbalance.sub(sideStakingAmountIn));

    const BPTEvent = receipt.events.filter((e) => e.event === "LOG_BPT");

    expect(BPTEvent[0].args.bptAmount.add(ssContractBPTbalance)).to.equal(
      await bPool.balanceOf(sideStaking.address)
    );

    // no dt token where taken from user3
    expect(await erc20Token.balanceOf(user3.address)).to.equal(user3DTbalance);
  });

  
  it("#12 - user3 removes liquidity with JoinPool, receiving both tokens", async () => {
    const user3DTbalance = await erc20Token.balanceOf(user3.address);
    const user3Oceanbalance = await oceanContract.balanceOf(user3.address);
    const ssContractDTbalance = await erc20Token.balanceOf(sideStaking.address);
    const ssContractBPTbalance = await bPool.balanceOf(sideStaking.address);
    // NO APPROVAL FOR BPT is required

    const user3BPTbalance = await bPool.balanceOf(user3.address);

    const BPTAmountIn = ethers.utils.parseEther("0.5");
    const minAmountOut = [
      web3.utils.toWei("1"), // min amount out for OCEAN AND DT
      web3.utils.toWei("1"),
    ];
    receipt = await (
      await bPool.connect(user3).exitPool(
        BPTAmountIn, //exact BPT token IN
        minAmountOut
      )
    ).wait();

    const ExitEvents = receipt.events.filter((e) => e.event === "LOG_EXIT");

    // we check all balances (DT,OCEAN,BPT)
    expect(ExitEvents[0].args.tokenOut).to.equal(erc20Token.address);
    expect(ExitEvents[1].args.tokenOut).to.equal(oceanContract.address);

    expect(ExitEvents[0].args.tokenAmountOut.add(user3DTbalance)).to.equal(
      await erc20Token.balanceOf(user3.address)
    );
    expect(ExitEvents[1].args.tokenAmountOut.add(user3Oceanbalance)).to.equal(
      await oceanContract.balanceOf(user3.address)
    );

    expect((await bPool.balanceOf(user3.address)).add(BPTAmountIn)).to.equal(
      user3BPTbalance
    );

    // NOW we check the ssContract BPT and DT balance didn't change.
    expect(ssContractBPTbalance).to.equal(
      await bPool.balanceOf(sideStaking.address)
    );

    expect(ssContractDTbalance).to.equal(
      await erc20Token.balanceOf(sideStaking.address)
    );
  });

  

  it("#14 - user3 removes liquidity with exitswapPoolAmountIn, receiving only Ocean tokens", async () => {
    const user3DTbalance = await erc20Token.balanceOf(user3.address);
    const user3Oceanbalance = await oceanContract.balanceOf(user3.address);
    const ssContractDTbalance = await erc20Token.balanceOf(sideStaking.address);
    const ssContractBPTbalance = await bPool.balanceOf(sideStaking.address);
    // NO APPROVAL FOR BPT is required

    const user3BPTbalance = await bPool.balanceOf(user3.address);

    const BPTAmountIn = ethers.utils.parseEther("0.5");
    const minDTOut = ethers.utils.parseEther("0.5");
    receipt = await (
      await bPool.connect(user3).exitswapPoolAmountIn(
        BPTAmountIn, //BPT token IN
        minDTOut // min amount DT out
      )
    ).wait();

    const BPTEvent = receipt.events.filter((e) => e.event === "LOG_BPT");


    // LOOK FOR EXIT EVENT
    const ExitEvent = receipt.events.filter((e) => e.event === "LOG_EXIT");

    // we check event arguments
    assert(ExitEvent[0].args.caller == user3.address);
    assert(ExitEvent[0].args.tokenOut == oceanContract.address);

    expect(await bPool.balanceOf(user3.address)).to.equal(
      user3BPTbalance.sub(BPTEvent[0].args.bptAmount)
    );

    
    expect(await erc20Token.balanceOf(user3.address)).to.equal(
      user3DTbalance
    );
    // we check user3 DT balance before and after
    
    expect(ExitEvent[0].args.tokenAmountOut.add(user3Oceanbalance)).to.equal(
      await oceanContract.balanceOf(user3.address)
    );
    // we also check user3 BPT balance before and after
    expect(user3BPTbalance).to.equal(
      (await bPool.balanceOf(user3.address)).add(BPTAmountIn)
    );
    
    
    
  });
  

  it("#17 - we check again no ocean and market fees were accounted", async () => {
    expect(await bPool.getOPCFee()).to.equal(0);
    expect(await bPool._swapPublishMarketFee()).to.equal(swapMarketFee);

    expect(await bPool.communityFees(oceanContract.address)).to.equal(0);
    expect(await bPool.communityFees(erc20Token.address)).to.equal(0);
    expect(await bPool.publishMarketFees(oceanContract.address)).gt(0);
    expect(await bPool.publishMarketFees(erc20Token.address)).gt(0);
  });
});