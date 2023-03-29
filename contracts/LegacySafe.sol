// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import "@enjinstarter/safe-global-safe-contracts/contracts/GnosisSafe.sol";

contract LegacySafe is GnosisSafe {
    uint256 public lastUsed;

    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Enum.Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) public payable virtual override returns (bool success) {
        lastUsed = block.timestamp;
        success = super.execTransaction(
            to,
            value,
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver,
            signatures
        );
    }
}
