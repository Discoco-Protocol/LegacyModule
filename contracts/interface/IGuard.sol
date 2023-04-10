// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

interface IGuard {
    function lastUsed(address) external view returns (uint256);
}