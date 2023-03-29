// SPDX-License-Identifier: MIT
pragma solidity >=0.8.7;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor(
        uint256 amount
    ) ERC20("DAI", "DAI") {
        _mint(msg.sender, amount * 1 ether);
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount * 1 ether);
    }
}
