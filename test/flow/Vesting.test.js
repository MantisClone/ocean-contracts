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
const {getEventFromTx} = require("../helpers/utils")
const { impersonate } = require("../helpers/impersonate");
const constants = require("../helpers/constants");
const { web3 } = require("@openzeppelin/test-helpers/src/setup");
const { keccak256 } = require("@ethersproject/keccak256");
const { ZERO_ADDRESS } = require("@openzeppelin/test-helpers/src/constants");
const ether = require("@openzeppelin/test-helpers/src/ether");
const ethers = hre.ethers;

describe("Vesting flow", () => {
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
    vestingAmount = web3.utils.toWei('10000'),
    vestedBlocks,
    dtIndex = null,
    oceanIndex = null,
    daiIndex = null;



  before("init contracts for each test", async () => {
    const ERC721Template = await ethers.getContractFactory("ERC721Template");
    const ERC20Template = await ethers.getContractFactory("ERC20Template");
    const ERC721Factory = await ethers.getContractFactory("ERC721Factory");

    const Router = await ethers.getContractFactory("FactoryRouter");
    const SSContract = await ethers.getContractFactory("SideStaking");
    const BPool = await ethers.getContractFactory("BPool");
    const FixedRateExchange = await ethers.getContractFactory(
      "FixedRateExchange"
    );
    const MockERC20 = await ethers.getContractFactory('MockERC20Decimals');
    
    [
      owner, // nft owner, 721 deployer
      reciever,
      user2, // 721Contract manager
      user3, // pool creator and liquidity provider
      user4, // user that swaps in POOL1
      user5, // user that swaps in POOL2
      user6,
      marketFeeCollector, // POOL1
      newMarketFeeCollector, // POOL1
      pool2MarketFeeCollector,
      opcCollector,
    ] = await ethers.getSigners();

    oceanContract = await MockERC20.deploy(
      'OCEAN','OCEAN',18
    );
    await oceanContract
      .transfer(user3.address, ethers.utils.parseEther("10000"));

   

    data = web3.utils.asciiToHex("SomeData");
    flags = web3.utils.asciiToHex(constants.blob[0]);

    // DEPLOY ROUTER, SETTING OWNER

    poolTemplate = await BPool.deploy();

   

    router = await Router.deploy(
      owner.address,
      oceanContract.address,
      poolTemplate.address, 
      opcCollector.address,
      []
    );

    sideStaking = await SSContract.deploy(router.address);

    fixedRateExchange = await FixedRateExchange.deploy(
      router.address,
      opcCollector.address
    );

    templateERC20 = await ERC20Template.deploy();


    // SETUP ERC721 Factory with template
    templateERC721 = await ERC721Template.deploy();
    factoryERC721 = await ERC721Factory.deploy(
      templateERC721.address,
      templateERC20.address,
      opcCollector.address,
      router.address
    );

    // SET REQUIRED ADDRESS

    
    await router.addFactory(factoryERC721.address);

    await router.addFixedRateContract(fixedRateExchange.address);
    
    await router.addSSContract(sideStaking.address)
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
    const event = getEventFromTx(txReceipt,'NFTCreated')
    assert(event, "Cannot find NFTCreated event")
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
    const trxERC20 = await tokenERC721.connect(user3).createERC20(1,
      ["ERC20DT1","ERC20DT1Symbol"],
      [user3.address,user6.address, user3.address,'0x0000000000000000000000000000000000000000'],
      [web3.utils.toWei("100000"),0],
      []
    );
    const trxReceiptERC20 = await trxERC20.wait();
    const event = getEventFromTx(trxReceiptERC20,'TokenCreated')
    assert(event, "Cannot find TokenCreated event")
    erc20Address = event.args[0];

    erc20Token = await ethers.getContractAt("ERC20Template", erc20Address);
    assert((await erc20Token.permissions(user3.address)).minter == true);
  });

  const swapFee = 1e15;
  const swapOceanFee = 1e15;
  const swapPublishMarketFee = 1e15;
  
  it("#4 - user3 calls deployPool(), but with a low vesting period. It should fail", async () => {
    // user3 hasn't minted any token so he can call deployPool()

    const ssDTBalance = await erc20Token.balanceOf(sideStaking.address);

    const initialOceanLiquidity = web3.utils.toWei("2000");
    const initialDTLiquidity = initialOceanLiquidity;
    // approve exact amount
    await oceanContract
      .connect(user3)
      .approve(router.address, web3.utils.toWei("2000"));

    // we deploy a new pool with burnInEndBlock as 0
    
    await expectRevert(erc20Token.connect(user3).deployPool(
       // sideStaking.address,
       // oceanContract.address,
        [
          web3.utils.toWei("1"), // rate
          18, // baseTokenDecimals
          web3.utils.toWei('10000'),
          20, // vested blocks  - this is our failure point
          initialOceanLiquidity, // baseToken initial pool liquidity
        ],
      //  user3.address,
        [
          swapFee, //
          swapPublishMarketFee,
        ],
       // marketFeeCollector.address,
       // user3.address // publisherAddress (get vested amount)
        [sideStaking.address,oceanContract.address,user3.address,user3.address,marketFeeCollector.address,poolTemplate.address]
      ), "ERC20Template: Vesting period too low. See FactoryRouter.minVestingPeriodInBlocks");
  });
  
  it("#5 - user3 calls deployPool(), we then check ocean and market fee", async () => {
    // user3 hasn't minted any token so he can call deployPool()

    const ssDTBalance = await erc20Token.balanceOf(sideStaking.address);

    const initialOceanLiquidity = web3.utils.toWei("2000");
    const initialDTLiquidity = initialOceanLiquidity;
    // approve exact amount
    await oceanContract
      .connect(user3)
      .approve(router.address, web3.utils.toWei("2000"));

    // we deploy a new pool with burnInEndBlock as 0
    receipt = await (
      await erc20Token.connect(user3).deployPool(
       // sideStaking.address,
       // oceanContract.address,
        [
          web3.utils.toWei("1"), // rate
          18, // baseTokenDecimals
          web3.utils.toWei('10000'),
          2500000, // vested blocks
          initialOceanLiquidity, // baseToken initial pool liquidity
        ],
      //  user3.address,
        [
          swapFee, //
          swapPublishMarketFee,
        ],
       // marketFeeCollector.address,
       // user3.address // publisherAddress (get vested amount)
        [sideStaking.address,oceanContract.address,user3.address,user3.address,marketFeeCollector.address,poolTemplate.address]
      )
    ).wait();
    const PoolEvent = getEventFromTx(receipt, 'NewPool')
    assert(PoolEvent, "Cannot find NewPool event")
    const VestingCreatedEvent = getEventFromTx(receipt, 'VestingCreated')
    assert(VestingCreatedEvent, "Cannot find VestingCreated event")
    assert(PoolEvent.args.ssContract == sideStaking.address);

    bPoolAddress = PoolEvent.args.poolAddress;

    bPool = await ethers.getContractAt("BPool", bPoolAddress);

    assert((await bPool.isFinalized()) == true);

    expect(await erc20Token.balanceOf(sideStaking.address)).to.equal(
      web3.utils.toWei("98000")
    );

    expect(await bPool.getOPCFee()).to.equal(0);
    expect(await bPool._swapPublishMarketFee()).to.equal(swapPublishMarketFee);

    expect(await bPool.communityFees(oceanContract.address)).to.equal(0);
    expect(await bPool.communityFees(erc20Token.address)).to.equal(0);
    expect(await bPool.publishMarketFees(oceanContract.address)).to.equal(0);
    expect(await bPool.publishMarketFees(erc20Token.address)).to.equal(0);
  });

  it("#6 - user3 fails to mints new erc20 tokens even if it's minter", async () => {
    assert((await erc20Token.permissions(user3.address)).minter == true);

    await expectRevert(
      erc20Token.connect(user3).mint(user3.address, web3.utils.toWei("10000")),
      "DatatokenTemplate: cap exceeded"
    );

    assert((await erc20Token.balanceOf(user3.address)) == 0);
  });

  it("#7 - we check vesting amount is correct", async () => {
    expect(await sideStaking.getvestingAmount(erc20Token.address)).to.equal(
      vestingAmount
    );

    // //console.log((await sideStaking.getvestingAmountSoFar(erc20Token.address)).toString())
    // console.log((await time.latestBlock()).toString());
    // await time.advanceBlockTo(12552485 + 3 * vestedBlocks);
    // console.log((await time.latestBlock()).toString());
  });

  it("#8 - we check vesting", async () => {
    const pubDTbalBEFORE = await erc20Token.balanceOf(tokenERC721.address);
    expect(await sideStaking.getvestingAmount(erc20Token.address)).to.equal(
      vestingAmount
    );
    //console.log(pubDTbalBEFORE.toString());
    const availableVesting = await sideStaking.getAvailableVesting(erc20Token.address)
    console.log("Available vesting: "+ethers.utils.formatEther(availableVesting));
    //console.log((await sideStaking.getvestingAmountSoFar(erc20Token.address)).toString())
    //console.log((await time.latestBlock()).toString());

    //await sideStaking.getVesting(erc20Token.address)

    // advance 1000 blocks
    // TODO: add test for intermediate steps (50%, etc)
    
    for (let i = 0; i < 1000; i++) {
      // each one advance a block
      const dummyTx=await user3.sendTransaction({
        to: user4.address,
        value: ethers.utils.parseEther("0.0"),
      });
      await dummyTx.wait()
    }
    const availableVestingAfterAdvance = await sideStaking.getAvailableVesting(erc20Token.address)
    console.log("Available vesting after 1000 blocks: "+ethers.utils.formatEther(availableVestingAfterAdvance));
    expect(availableVestingAfterAdvance.gt(availableVesting), 'Available vesting was not increased!')
    const tx=await sideStaking.getVesting(erc20Token.address);
    const txReceipt = await tx.wait();
    const VestingCreatedEvent = getEventFromTx(txReceipt, 'Vesting')
    assert(VestingCreatedEvent, "Cannot find Vesting event")
    const pubDTbalAFTER = await erc20Token.balanceOf(tokenERC721.address);
    expect(pubDTbalAFTER.gt(pubDTbalBEFORE), 'Publisher balance was not increased!')
  });
});