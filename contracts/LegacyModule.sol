// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Enum} from "./enum/Enum.sol";
import {IGnosisSafe} from "./interface/IGnosisSafe.sol";
import {IGuard} from "./interface/IGuard.sol";

error NotDead();
error NotConfirmed();
error NotSettled();
error NotHeir();
error NotERC20Heir(address);
error NotSetERC20(address);
error Claimed();
error TooManyERC20s();
error TooManyHeirs();
error InvalidHeir();
error InvalidERC20();
error InsufficientERC20();
error InsufficientETH();
error InvalidERC20List();
error InvalidHeirList();
error WrongNFTHeir(address, address, uint256, address);
error InvalidNFTHeirParams();
error DuplicateHeir(address);
error DuplicateERC20(address);
error DuplicateProposal();
error NonexistERC20();
error NonexistHeir();
error ETHTransferFailed();
error TokenTransferFailed();

contract LegacyModule {
    using EnumerableSet for EnumerableSet.AddressSet;
    address constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
    uint256 public immutable dead_period;
    uint256 public immutable proposal_time_lock;
    IGuard public legacyGuard;
    // safe => heirs
    mapping(address => EnumerableSet.AddressSet) heirs;
    // safe => owned erc20 tokens
    mapping(address => EnumerableSet.AddressSet) erc20Tokens;
    // safe => nft address => tokenId => specified heir
    mapping(address => mapping(address => mapping(uint256 => address)))
        public nftHeir;
    // safe => proposal time
    mapping(address => uint256) public proposals;
    // safe => token => balance after dead
    mapping(address => mapping(address => uint256)) public finalBalancePer;
    // safe => token => user => claimed
    mapping(address => mapping(address => mapping(address => bool)))
        public claimed;
    // safe => wheather tokens can be transferred (confirm safe owner is dead)
    mapping(address => bool) public settled;

    event HeirsSet(address indexed safe, address[] heirs);
    event HeirsAdded(address indexed safe, address[] heirs);
    event HeirsRemoved(address indexed safe, address[] heirs);
    event ERC20Added(address indexed safe, address[] erc20s);
    event ERC20Removed(address indexed safe, address[] erc20s);
    event ERC20TokensSet(address indexed safe, address[] erc20Tokens);
    event NFTHeirSet(
        address indexed safe,
        address[] nftAddress,
        uint256[] tokenId,
        address[] heir
    );
    event NFTHeirRemoved(
        address indexed safe,
        address[] nftAddress,
        uint256[] tokenId,
        address[] heir
    );
    event Settled(address indexed safe);
    event ETHClaimed(
        address indexed safe,
        address indexed heir,
        uint256 portion
    );
    event ERC20Claimed(
        address indexed safe,
        address indexed token,
        address indexed heir,
        uint256 portion
    );
    event ERC721Claimed(
        address indexed safe,
        address indexed token,
        address indexed heir,
        uint256 tokenId
    );
    event Propose(uint256 timestamp);

    constructor(address _legacyGuard) {
        legacyGuard = IGuard(_legacyGuard);
        dead_period = 180;
        proposal_time_lock = 60;
    }

    function setERC20Heirs(address[] calldata heir) external {
        if (heir.length > 10 || heir.length == 0) {
            revert InvalidHeirList();
        }
        EnumerableSet.AddressSet storage heirSet = heirs[msg.sender];
        address[] memory _prevValues = heirSet.values();
        for (uint256 i; i < _prevValues.length; ) {
            heirSet.remove(_prevValues[i]);
            unchecked {
                ++i;
            }
        }
        for (uint256 i; i < heir.length; ) {
            if (heir[i] == address(0)) {
                revert InvalidHeir();
            }
            if (!heirSet.add(heir[i])) {
                revert DuplicateHeir(heir[i]);
            }
            unchecked {
                ++i;
            }
        }

        emit HeirsSet(msg.sender, heir);
    }

    function addERC20Heirs(address[] calldata heir) external {
        if (heir.length == 0) {
            revert InvalidHeirList();
        }
        EnumerableSet.AddressSet storage heirSet = heirs[msg.sender];
        if (heirSet.length() + heir.length > 10) {
            revert TooManyHeirs();
        }
        for (uint256 i; i < heir.length; ) {
            if (heir[i] == address(0)) {
                revert InvalidHeir();
            }
            if (!heirSet.add(heir[i])) {
                revert DuplicateHeir(heir[i]);
            }
            unchecked {
                ++i;
            }
        }

        emit HeirsAdded(msg.sender, heir);
    }

    function removeERC20Heirs(address[] calldata heir) external {
        if (heir.length == 0) {
            revert InvalidHeirList();
        }
        EnumerableSet.AddressSet storage heirSet = heirs[msg.sender];
        for (uint256 i; i < heir.length; ) {
            if (!heirSet.contains(heir[i])) {
                revert NotERC20Heir(heir[i]);
            }
            heirSet.remove(heir[i]);
            unchecked {
                ++i;
            }
        }

        emit HeirsRemoved(msg.sender, heir);
    }

    function isERC20Heir(
        address safe,
        address heir
    ) external view returns (bool) {
        return heirs[safe].contains(heir);
    }

    function isERC20Set(
        address safe,
        address erc20
    ) external view returns (bool) {
        return erc20Tokens[safe].contains(erc20);
    }

    function setERC20Tokens(address[] calldata _erc20Tokens) external {
        if (_erc20Tokens.length > 30 || _erc20Tokens.length == 0) {
            revert InvalidERC20List();
        }
        EnumerableSet.AddressSet storage erc20TokensSet = erc20Tokens[
            msg.sender
        ];
        address[] memory _prevValues = erc20TokensSet.values();
        for (uint256 i; i < _prevValues.length; ) {
            erc20TokensSet.remove(_prevValues[i]);
            unchecked {
                ++i;
            }
        }
        for (uint256 i; i < _erc20Tokens.length; ) {
            if (_erc20Tokens[i] == address(0)) {
                revert InvalidERC20();
            }
            if (!erc20TokensSet.add(_erc20Tokens[i])) {
                revert DuplicateERC20(_erc20Tokens[i]);
            }
            unchecked {
                ++i;
            }
        }

        emit ERC20TokensSet(msg.sender, _erc20Tokens);
    }

    function addERC20Tokens(address[] calldata _erc20Tokens) external {
        if (_erc20Tokens.length == 0) {
            revert InvalidERC20List();
        }
        EnumerableSet.AddressSet storage erc20TokensSet = erc20Tokens[
            msg.sender
        ];
        if (erc20TokensSet.length() + _erc20Tokens.length > 30) {
            revert TooManyERC20s();
        }
        for (uint256 i; i < _erc20Tokens.length; ) {
            if (_erc20Tokens[i] == address(0)) {
                revert InvalidERC20();
            }
            if (!erc20TokensSet.add(_erc20Tokens[i])) {
                revert DuplicateERC20(_erc20Tokens[i]);
            }
            unchecked {
                ++i;
            }
        }

        emit ERC20Added(msg.sender, _erc20Tokens);
    }

    function removeERC20Tokens(address[] calldata _erc20Tokens) external {
        if (_erc20Tokens.length == 0) {
            revert InvalidERC20List();
        }
        EnumerableSet.AddressSet storage erc20TokensSet = erc20Tokens[
            msg.sender
        ];
        for (uint256 i; i < _erc20Tokens.length; ) {
            if (!erc20TokensSet.contains(_erc20Tokens[i])) {
                revert NotSetERC20(_erc20Tokens[i]);
            }
            erc20TokensSet.remove(_erc20Tokens[i]);
            unchecked {
                ++i;
            }
        }

        emit ERC20Removed(msg.sender, _erc20Tokens);
    }

    function setNFTHeir(
        address[] calldata nftAddress,
        uint256[] calldata tokenId,
        address[] calldata heir
    ) external {
        if (
            !(nftAddress.length > 0 &&
                nftAddress.length == tokenId.length &&
                nftAddress.length == heir.length)
        ) {
            revert InvalidNFTHeirParams();
        }
        for (uint256 i; i < nftAddress.length; ) {
            if (nftAddress[i] == address(0) || heir[i] == address(0)) {
                revert InvalidNFTHeirParams();
            }
            nftHeir[msg.sender][nftAddress[i]][tokenId[i]] = heir[i];
            unchecked {
                ++i;
            }
        }

        emit NFTHeirSet(msg.sender, nftAddress, tokenId, heir);
    }

    function removeNFTHeir(
        address[] calldata nftAddress,
        uint256[] calldata tokenId,
        address[] calldata heir
    ) external {
        if (
            !(nftAddress.length > 0 &&
                nftAddress.length == tokenId.length &&
                nftAddress.length == heir.length)
        ) {
            revert InvalidNFTHeirParams();
        }
        for (uint i; i < nftAddress.length; ++i) {
            if (
                nftHeir[msg.sender][nftAddress[i]][tokenId[i]] != heir[i] ||
                heir[i] == address(0)
            ) {
                revert WrongNFTHeir(
                    msg.sender,
                    nftAddress[i],
                    tokenId[i],
                    heir[i]
                );
            }
            delete nftHeir[msg.sender][nftAddress[i]][tokenId[i]];
        }
        emit NFTHeirRemoved(msg.sender, nftAddress, tokenId, heir);
    }

    function propose(address safe) external {
        uint256 lastUsed = legacyGuard.lastUsed();
        // require current timestamp is greater than lastUsed plus dead period
        if (lastUsed + dead_period >= block.timestamp) {
            revert NotDead();
        }
        if (proposals[safe] > lastUsed) {
            revert DuplicateProposal();
        }
        proposals[safe] = block.timestamp;

        emit Propose(block.timestamp);
    }

    function settle(address safe) external {
        uint256 lastUsed = legacyGuard.lastUsed();
        if (lastUsed + dead_period >= proposals[safe]) {
            revert NotDead();
        }
        if (proposals[safe] + proposal_time_lock >= block.timestamp) {
            revert NotConfirmed();
        }
        settled[safe] = true;
        emit Settled(safe);
    }

    // 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE
    function claimETH(address safe, address heir) external {
        if (!settled[safe]) {
            revert NotSettled();
        }
        EnumerableSet.AddressSet storage heirSet = heirs[safe];
        if (!heirSet.contains(heir)) {
            revert NonexistHeir();
        }
        if (finalBalancePer[safe][ETH_ADDRESS] == 0) {
            uint256 balance = safe.balance;
            finalBalancePer[safe][ETH_ADDRESS] = balance / heirSet.length();
        }
        uint256 portion = finalBalancePer[safe][ETH_ADDRESS];
        if (portion == 0) {
            revert InsufficientETH();
        }
        if (claimed[safe][ETH_ADDRESS][heir]) {
            revert Claimed();
        }
        claimed[safe][ETH_ADDRESS][heir] = true;
        if (
            !IGnosisSafe(safe).execTransactionFromModule(
                heir,
                portion,
                "",
                Enum.Operation.Call
            )
        ) {
            // revert "Could not execute token transfer"
            revert ETHTransferFailed();
        }

        emit ETHClaimed(safe, heir, portion);
    }

    function claimERC20(address safe, address token, address heir) external {
        if (!settled[safe]) {
            revert NotSettled();
        }
        if (!erc20Tokens[safe].contains(token)) {
            revert NonexistERC20();
        }
        EnumerableSet.AddressSet storage heirSet = heirs[safe];
        if (!heirSet.contains(heir)) {
            revert NonexistHeir();
        }
        if (finalBalancePer[safe][token] == 0) {
            uint256 balance = IERC20(token).balanceOf(safe);
            finalBalancePer[safe][token] = balance / heirSet.length();
        }
        uint256 portion = finalBalancePer[safe][token];
        if (portion == 0) {
            revert InsufficientERC20();
        }
        if (claimed[safe][token][heir]) {
            revert Claimed();
        }
        claimed[safe][token][heir] = true;
        // construct the bytes to call safe execTransactionFromMudule
        bytes memory data = abi.encodeWithSignature(
            "transfer(address,uint256)",
            heir,
            portion
        );
        if (
            !IGnosisSafe(safe).execTransactionFromModule(
                token,
                0,
                data,
                Enum.Operation.Call
            )
        ) {
            // revert "Could not execute token transfer"
            revert TokenTransferFailed();
        }

        emit ERC20Claimed(safe, token, heir, portion);
    }

    function claimERC721(
        address safe,
        address nft,
        uint256 tokenId,
        address heir
    ) external {
        if (!settled[safe]) {
            revert NotSettled();
        }
        // safe => nft address => tokenId => specified heir
        // mapping(address => mapping(address => mapping(uint256 => address))) public nftHeir;
        if (nftHeir[safe][nft][tokenId] != heir) {
            revert NotHeir();
        }
        // construct the bytes to call safe execTransactionFromMudule
        bytes memory data = abi.encodeWithSignature(
            "transferFrom(address,address,uint256)",
            address(safe),
            heir,
            tokenId
        );
        if (
            !IGnosisSafe(safe).execTransactionFromModule(
                nft,
                0,
                data,
                Enum.Operation.Call
            )
        ) {
            // revert "Could not execute token transfer"
            revert TokenTransferFailed();
        }

        emit ERC721Claimed(safe, nft, heir, tokenId);
    }
}
