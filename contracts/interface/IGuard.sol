// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IGuard {
    function lastUsed() external view returns (uint256);
}