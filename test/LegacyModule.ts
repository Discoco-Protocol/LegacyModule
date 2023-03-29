import { time, loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import { ethers, network } from "hardhat";
import { TypedDataSigner } from "@ethersproject/abstract-signer";
import { BigNumber, Contract, BigNumberish, Signer, Wallet } from "ethers";
// import  SafeProxyFactory  from "@gnosis.pm/safe-contracts/contracts/proxies/GnosisSafeProxy.sol";
// import { GnosisSafeProxyFactory } from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json";
import GnosisSafeProxyFactory from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxyFactory.sol/GnosisSafeProxyFactory.json";
// import GnosisSafeProxy from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxy.sol/GnosisSafeProxy.json";
// import SafeProxy from "@gnosis.pm/safe-contracts/build/artifacts/contracts/proxies/GnosisSafeProxy.sol/GnosisSafeProxy.json";
import GnosisSafe from "@gnosis.pm/safe-contracts/build/artifacts/contracts/GnosisSafe.sol/GnosisSafe.json";

import { AddressZero } from "@ethersproject/constants";

// import utils from '@gnosis.pm/safe-contracts/test/utils/general';
// import { utils } from "@gnosis.pm/safe-contracts/test/utils/general";
// import * as FriendCard from './../pages/FriendCard';
// const utils = require('@gnosis.pm/safe-contracts/test/utils/general')
const ADDRESS_0 = "0x0000000000000000000000000000000000000000"
interface MetaTransaction {
    to: string;
    value: string | number | BigNumber;
    data: string;
    operation: number;
}

interface SafeTransaction extends MetaTransaction {
    safeTxGas: string | number;
    baseGas: string | number;
    gasPrice: string | number;
    gasToken: string;
    refundReceiver: string;
    nonce: string | number;
}

const buildSafeTransaction = (template: {
    to: string;
    value?: BigNumber | number | string;
    data?: string;
    operation?: number;
    safeTxGas?: number | string;
    baseGas?: number | string;
    gasPrice?: number | string;
    gasToken?: string;
    refundReceiver?: string;
    nonce: number;
}): SafeTransaction => {
    return {
        to: template.to,
        value: template.value || 0,
        data: template.data || "0x",
        operation: template.operation || 0,
        safeTxGas: template.safeTxGas || 0,
        baseGas: template.baseGas || 0,
        gasPrice: template.gasPrice || 0,
        gasToken: template.gasToken || AddressZero,
        refundReceiver: template.refundReceiver || AddressZero,
        nonce: template.nonce,
    };
};

const EIP712_SAFE_TX_TYPE = {
    // "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
    SafeTx: [
        { type: "address", name: "to" },
        { type: "uint256", name: "value" },
        { type: "bytes", name: "data" },
        { type: "uint8", name: "operation" },
        { type: "uint256", name: "safeTxGas" },
        { type: "uint256", name: "baseGas" },
        { type: "uint256", name: "gasPrice" },
        { type: "address", name: "gasToken" },
        { type: "address", name: "refundReceiver" },
        { type: "uint256", name: "nonce" },
    ],
};

// 31337

const buildContractCall = (
    contract: Contract,
    method: string,
    params: any[],
    nonce: number,
    delegateCall?: boolean,
    overrides?: Partial<SafeTransaction>,
): SafeTransaction => {
    const data = contract.interface.encodeFunctionData(method, params);
    return buildSafeTransaction(
        Object.assign(
            {
                to: contract.address,
                data,
                operation: delegateCall ? 1 : 0,
                nonce,
            },
            overrides,
        ),
    );
};

interface SafeSignature {
    signer: string;
    data: string;
    // a flag to indicate if the signature is a contract signature and the data has to be appended to the dynamic part of signature bytes
    dynamic?: true;
}

const safeSignTypedData = async (
    signer: Signer & TypedDataSigner,
    safe: Contract,
    safeTx: SafeTransaction,
    chainId?: BigNumberish,
): Promise<SafeSignature> => {
    if (!chainId && !signer.provider) throw Error("Provider required to retrieve chainId");
    const cid = chainId || (await signer.provider!.getNetwork()).chainId;
    const signerAddress = await signer.getAddress();

    return {
        signer: signerAddress,
        data: await signer._signTypedData({ verifyingContract: safe.address, chainId: cid }, EIP712_SAFE_TX_TYPE, safeTx),
    };
};

const buildSignatureBytes = (signatures: SafeSignature[]): string => {
    const SIGNATURE_LENGTH_BYTES = 65;
    signatures.sort((left, right) => left.signer.toLowerCase().localeCompare(right.signer.toLowerCase()));

    let signatureBytes = "0x";
    let dynamicBytes = "";
    for (const sig of signatures) {
        if (sig.dynamic) {
            /* 
                A contract signature has a static part of 65 bytes and the dynamic part that needs to be appended at the end of 
                end signature bytes.
                The signature format is
                Signature type == 0
                Constant part: 65 bytes
                {32-bytes signature verifier}{32-bytes dynamic data position}{1-byte signature type}
                Dynamic part (solidity bytes): 32 bytes + signature data length
                {32-bytes signature length}{bytes signature data}
            */
            const dynamicPartPosition = (signatures.length * SIGNATURE_LENGTH_BYTES + dynamicBytes.length / 2)
                .toString(16)
                .padStart(64, "0");
            const dynamicPartLength = (sig.data.slice(2).length / 2).toString(16).padStart(64, "0");
            const staticSignature = `${sig.signer.slice(2).padStart(64, "0")}${dynamicPartPosition}00`;
            const dynamicPartWithLength = `${dynamicPartLength}${sig.data.slice(2)}`;

            signatureBytes += staticSignature;
            dynamicBytes += dynamicPartWithLength;
        } else {
            signatureBytes += sig.data.slice(2);
        }
    }

    return signatureBytes + dynamicBytes;
};

const executeTx = async (safe: Contract, safeTx: SafeTransaction, signatures: SafeSignature[], overrides?: any): Promise<any> => {
    const signatureBytes = buildSignatureBytes(signatures);
    return safe.execTransaction(
        safeTx.to,
        safeTx.value,
        safeTx.data,
        safeTx.operation,
        safeTx.safeTxGas,
        safeTx.baseGas,
        safeTx.gasPrice,
        safeTx.gasToken,
        safeTx.refundReceiver,
        signatureBytes,
        overrides || {},
    );
};

const executeTxWithSigners = async (safe: Contract, tx: SafeTransaction, signers: Wallet[], overrides?: any) => {
    const sigs = await Promise.all(signers.map((signer) => safeSignTypedData(signer, safe, tx, 31337)));
    return executeTx(safe, tx, sigs, overrides);
};

const executeContractCallWithSigners = async (
    safe: Contract,
    contract: Contract,
    method: string,
    params: any[],
    signers: Wallet[],
    delegateCall?: boolean,
    overrides?: Partial<SafeTransaction>,
) => {
    const tx = buildContractCall(contract, method, params, await safe.nonce(), delegateCall, overrides);
    return executeTxWithSigners(safe, tx, signers);
};

describe("Safe", function () {
    async function deploySafe() {
        const SafeProxyFactory = await ethers.getContractFactoryFromArtifact(GnosisSafeProxyFactory);
        const safeProxyFactory = await SafeProxyFactory.deploy();

        const Safe = await ethers.getContractFactoryFromArtifact(GnosisSafe);
        const safe = await Safe.deploy();

        // const SafeProxy = await ethers.getContractFactoryFromArtifact(GnosisSafeProxy);
        const safeAddress = `0x168dd867B3D896C5CB80DD4E759b3AA14E321d57`;
        const safeProxy = Safe.attach(safeAddress);

        await safeProxyFactory.createProxyWithNonce(safe.address, "0x", 1);
        // const nonce = await safeProxy.nonce();
        // console.log(nonce.toString());

        // const ADDRESS_0 = "0x0000000000000000000000000000000000000000"


        // safe address => 0x168dd867B3D896C5CB80DD4E759b3AA14E321d57
        // safeProxyFactory.on("ProxyCreation", (proxy, _singleton, event) => {
        //     // const erc20Address = proxy;
        //     console.log("New Safe is ", proxy);
        // })
        // await new Promise(res => setTimeout(() => res(null), 5000));
        const user1 = new ethers.Wallet(`0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`, ethers.provider);
        const user2 = new ethers.Wallet(`0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`, ethers.provider);

        await safeProxy.setup([user1.address, user2.address], 2, ADDRESS_0, "0x", ADDRESS_0, ADDRESS_0, 0, ADDRESS_0);

        const Guard = await ethers.getContractFactory("LegacyGuard");
        const guard = await Guard.deploy();

        const LegacyModule = await ethers.getContractFactory("LegacyModule");
        const module = await LegacyModule.deploy(guard.address);

        const MockERC20 = await ethers.getContractFactory("MockERC20");
        const mockERC20_1 = await MockERC20.connect(user1).deploy(1000000);
        const mockERC20_2 = await MockERC20.connect(user1).deploy(2000000);
        await mockERC20_1.connect(user1).transfer(safeProxy.address, ethers.utils.parseEther("1000000"));

        await mockERC20_2.connect(user1).transfer(safeProxy.address, ethers.utils.parseEther("2000000"));

        await executeContractCallWithSigners(safeProxy, safeProxy, "setGuard", [guard.address], [user1, user2]);
        await executeContractCallWithSigners(safeProxy, safeProxy, "enableModule", [module.address], [user1, user2]);

        return { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 };
    }

    it("Set ERC20", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);

        // const safeBalance = await mockERC20_1.balanceOf(safeProxy.address);
        // console.log(safeBalance.toString());

        // const safeBalance2 = await mockERC20_2.balanceOf(safeProxy.address);
        // console.log(safeBalance2.toString());
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);
        // const lastUsed = await guard.lastUsed();
        // console.log(lastUsed.toString());
    });

    it("Set Heir", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);

        // const safeBalance = await mockERC20_1.balanceOf(safeProxy.address);
        // console.log(safeBalance.toString());

        // const safeBalance2 = await mockERC20_2.balanceOf(safeProxy.address);
        // console.log(safeBalance2.toString());
        await executeContractCallWithSigners(safeProxy, module, "setERC20Heirs", [[user1.address, user2.address]], [user1, user2]);
        await executeContractCallWithSigners(safeProxy, module, "setERC20Heirs", [[user1.address, user2.address]], [user1, user2]);
        // const lastUsed = await guard.lastUsed();
        // console.log(lastUsed.toString());
    });

    it("Propose", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);

        // const safeBalance = await mockERC20_1.balanceOf(safeProxy.address);
        // console.log(safeBalance.toString());

        // const safeBalance2 = await mockERC20_2.balanceOf(safeProxy.address);
        // console.log(safeBalance2.toString());
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);
        await expect(module.propose(safeProxy.address)).revertedWithCustomError(module, "NotDead");
        await time.increase(86400 * 300);
        await expect(module.propose(safeProxy.address)).revertedWithCustomError(module, "NotDead");
        await time.increase(86400 * 61);
        await module.propose(safeProxy.address);
        await expect(module.propose(safeProxy.address)).revertedWithCustomError(module, "DuplicateProposal");
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);
        await expect(module.propose(safeProxy.address)).revertedWithCustomError(module, "NotDead");
        await time.increase(86400 * 380);
        await module.propose(safeProxy.address);
    });

    it("Settle", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);
        await time.increase(86400 * 361);
        await module.propose(safeProxy.address);
        await time.increase(86400 * 1);
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);
        await time.increase(86400 * 200);
        await expect(module.settle(safeProxy.address)).revertedWithCustomError(module, "NotDead");
        await time.increase(86400 * 161);
        await module.propose(safeProxy.address);
        await time.increase(86400 * 200);
        await module.settle(safeProxy.address);
    });

    it("Claim ERC20", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);

        await executeContractCallWithSigners(safeProxy, module, "setERC20Heirs", [[user1.address, user2.address]], [user1, user2]);
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);

        await time.increase(86400 * 361);
        await module.propose(safeProxy.address);
        await time.increase(86400 * 200);
        await module.settle(safeProxy.address);

        await module.claimERC20(safeProxy.address, mockERC20_1.address, user1.address);

        const erc20_1_user1_balance = await mockERC20_1.balanceOf(user1.address);
        console.log(erc20_1_user1_balance.toString());
        let erc20_1_user2_balance = await mockERC20_1.balanceOf(user2.address);
        console.log(erc20_1_user2_balance.toString());
        await module.claimERC20(safeProxy.address, mockERC20_1.address, user2.address);
        erc20_1_user2_balance = await mockERC20_1.balanceOf(user2.address);
        console.log(erc20_1_user2_balance.toString());
        await expect(module.claimERC20(safeProxy.address, mockERC20_1.address, user1.address)).revertedWithCustomError(module, "Claimed");
    });

    it("Claim ETH", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);

        await executeContractCallWithSigners(safeProxy, module, "setERC20Heirs", [[user1.address, user2.address]], [user1, user2]);
        await executeContractCallWithSigners(safeProxy, module, "setERC20Tokens", [[mockERC20_1.address, mockERC20_2.address]], [user1, user2]);

        await time.increase(86400 * 361);
        await module.propose(safeProxy.address);
        await time.increase(86400 * 200);
        await module.settle(safeProxy.address);
        // Set balance to 10 ETH
        await network.provider.send("hardhat_setBalance", [
            safeProxy.address,
            `0xA688906BD8B00000`,
        ]);

        let user1_balance = await user1.getBalance();
        console.log(user1_balance.toString());
        let safe_balance = await ethers.provider.getBalance(safeProxy.address);
        console.log("safe balance ", safe_balance.toString());


        await module.claimETH(safeProxy.address, user1.address);

        user1_balance = await user1.getBalance();
        console.log(user1_balance.toString());
        await expect(module.claimETH(safeProxy.address, user1.address)).revertedWithCustomError(module, "Claimed");

        let user2_balance = await user2.getBalance();
        console.log(user2_balance.toString());

        await module.claimETH(safeProxy.address, user2.address);
        user2_balance = await user2.getBalance();
        console.log(user2_balance.toString());

        await expect(module.claimETH(safeProxy.address, user2.address)).revertedWithCustomError(module, "Claimed");

        safe_balance = await ethers.provider.getBalance(safeProxy.address);
        console.log("safe balance ", safe_balance.toString());
    });

    it("Claim ERC721", async function () {
        const { safeProxy, module, guard, mockERC20_1, mockERC20_2, user1, user2 } = await loadFixture(deploySafe);
        const MockERC721 = await ethers.getContractFactory("MockERC721");
        const mockERC721 = await MockERC721.deploy();
        await mockERC721.mint(safeProxy.address);
        await mockERC721.mint(safeProxy.address);
        let ownerOf0 = await mockERC721.ownerOf(0);
        console.log(ownerOf0);

        let ownerOf1 = await mockERC721.ownerOf(1);
        console.log(ownerOf1);
        await executeContractCallWithSigners(safeProxy, module, "setNFTHeir", [[mockERC721.address, mockERC721.address], [0, 1], [user1.address, user2.address]], [user1, user2]);

        await time.increase(86400 * 361);
        await module.propose(safeProxy.address);
        await time.increase(86400 * 200);
        await module.settle(safeProxy.address);

        await module.claimERC721(safeProxy.address, mockERC721.address, 0, user1.address);
        ownerOf0 = await mockERC721.ownerOf(0);
        console.log(ownerOf0);
        console.log(user1.address);
        // await module.claimERC721(safeProxy.address, mockERC721.address, 0, user1.address);
        await expect(module.claimERC721(safeProxy.address, mockERC721.address, 1, user1.address)).revertedWithCustomError(module, "NotHeir");
        await module.claimERC721(safeProxy.address, mockERC721.address, 1, user2.address);
        ownerOf1 = await mockERC721.ownerOf(1);
        console.log(ownerOf1);
        console.log(user2.address);
        
    });
});