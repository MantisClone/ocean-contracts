pragma solidity ^0.5.7;
// Copyright BigchainDB GmbH and Ocean Protocol contributors
// SPDX-License-Identifier: (Apache-2.0 AND CC-BY-4.0)
// Code is Apache-2.0 and docs are CC-BY-4.0

import "openzeppelin-solidity/contracts/math/SafeMath.sol";

contract FeeCalculator {

    using SafeMath for uint256;
    uint256 constant private BASE_TX_COST = 44000;
    uint256 constant private FACTOR_1 = 10;
    uint256 constant private BASE = 10;
    
    function calculateRange(
        uint256 number
    ) 
        internal
        pure
        returns(uint256)
    {
        uint256 remainder = number;
        uint256 zeros = 0;
        for(uint256 i=0 ; remainder >= BASE; i++){
            remainder = remainder.div(BASE);
            zeros +=1 ;
        }
        return zeros;
    }
    
    
    function calculateFee(
        uint256 tokens,
        uint256 totalSupply
    )
        public
        pure
        returns(uint256)
    {
        require(
            totalSupply >= tokens,
            'Invalid totalSupply'
        );
        
        uint256 tokensRange = calculateRange(tokens);
        uint256 tokensRangeToll = tokensRange.mul(BASE_TX_COST);
        uint256 toll = tokensRangeToll.div(calculateRange(totalSupply)).div(FACTOR_1);
        return toll;
    }
}