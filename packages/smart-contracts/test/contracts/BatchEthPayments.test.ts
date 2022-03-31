import { ethers, network } from 'hardhat';
import { BigNumber, Signer } from 'ethers';
import { expect, use } from 'chai';
import { solidity } from 'ethereum-waffle';
import { EthereumFeeProxy, BatchPayments } from '../../src/types';
import { batchPaymentsArtifact } from '../../src/lib';

import { ethereumFeeProxyArtifact } from '../../src/lib';
import { HttpNetworkConfig } from 'hardhat/types';

use(solidity);

const logGasInfos = false;

describe('contract: BatchPayments: Ethereum', () => {
  let payee1: string;
  let payee2: string;
  let feeAddress: string;
  let batchAddress: string;

  let owner: Signer;
  let payee1Sig: Signer;

  let beforeEthBalance1: BigNumber;
  let beforeEthBalance2: BigNumber;
  let afterEthBalance1: BigNumber;
  let afterEthBalance2: BigNumber;

  const referenceExample1 = '0xaaaa';
  const referenceExample2 = '0xbbbb';

  let ethFeeProxy: EthereumFeeProxy;
  let batch: BatchPayments;
  const networkConfig = network.config as HttpNetworkConfig;
  const provider = new ethers.providers.JsonRpcProvider(networkConfig.url);

  before(async () => {
    [, payee1, payee2, feeAddress] = (await ethers.getSigners()).map((s) => s.address);
    [owner, payee1Sig] = await ethers.getSigners();

    ethFeeProxy = ethereumFeeProxyArtifact.connect(network.name, owner);
    batch = batchPaymentsArtifact.connect(network.name, owner);
    batchAddress = batch.address;
    await batch.connect(owner).setBatchFee(10);
  });

  describe('Batch Eth normal flow', () => {
    it('Should pay 2 payments and contract do not keep funds of ethers', async function () {
      beforeEthBalance1 = await provider.getBalance(payee1);
      beforeEthBalance2 = await provider.getBalance(payee2);

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [200, 300],
            [referenceExample1, referenceExample2],
            [10, 20],
            feeAddress,
            {
              value: BigNumber.from('1000'),
            },
          ),
      )
        .to.emit(ethFeeProxy, 'TransferWithReferenceAndFee')
        .withArgs(payee1, '200', ethers.utils.keccak256(referenceExample1), '10', feeAddress)
        .to.emit(ethFeeProxy, 'TransferWithReferenceAndFee')
        .withArgs(payee2, '300', ethers.utils.keccak256(referenceExample2), '20', feeAddress);

      afterEthBalance1 = await provider.getBalance(payee1);
      expect(afterEthBalance1).to.be.equal(beforeEthBalance1.add(200));

      afterEthBalance2 = await provider.getBalance(payee2);
      expect(afterEthBalance2).to.be.equal(beforeEthBalance2.add(300));

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });

    it('Should pay 2 payments with the exact amount', async function () {
      beforeEthBalance1 = await provider.getBalance(payee1);
      beforeEthBalance2 = await provider.getBalance(payee2);

      const totalAmout = BigNumber.from('535'); // amount: 500, fee: 10+20, batchFee: 2+3

      const tx = await batch
        .connect(owner)
        .batchEthPaymentsWithReference(
          [payee1, payee2],
          [200, 300],
          [referenceExample1, referenceExample2],
          [10, 20],
          feeAddress,
          {
            value: totalAmout,
          },
        );
      await tx.wait();

      afterEthBalance1 = await provider.getBalance(payee1);
      expect(afterEthBalance1).to.be.equal(beforeEthBalance1.add(200));

      afterEthBalance2 = await provider.getBalance(payee2);
      expect(afterEthBalance2).to.be.equal(beforeEthBalance2.add(300));

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });

    it('Should pay 10 Ethereum payments', async function () {
      beforeEthBalance2 = await provider.getBalance(payee2);

      const amount = 2;
      const feeAmount = 1;
      const nbTxs = 10; // to compare gas optim, go to 100.
      const [_, recipients, amounts, paymentReferences, feeAmounts] = getBatchPaymentsInputs(
        nbTxs,
        '_noTokenAddress',
        payee2,
        amount,
        referenceExample1,
        feeAmount,
      );
      const totalAmount = BigNumber.from(((amount + feeAmount) * nbTxs).toString());

      const tx = await batch
        .connect(owner)
        .batchEthPaymentsWithReference(
          recipients,
          amounts,
          paymentReferences,
          feeAmounts,
          feeAddress,
          {
            value: totalAmount,
          },
        );

      const receipt = await tx.wait();
      if (logGasInfos) {
        console.log(`nbTxs= ${nbTxs}, gas consumption: `, receipt.gasUsed.toString());
      }

      afterEthBalance2 = await provider.getBalance(payee2);
      expect(afterEthBalance2).to.be.equal(beforeEthBalance2.add(amount * nbTxs));

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });
  });

  describe('Batch revert, issues with: args, or funds, or approval', () => {
    it('Should revert batch if not enough funds', async function () {
      beforeEthBalance1 = await provider.getBalance(payee1);
      beforeEthBalance2 = await provider.getBalance(payee2);

      const totalAmout = BigNumber.from('400');

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [200, 300],
            [referenceExample1, referenceExample2],
            [10, 20],
            feeAddress,
            {
              value: totalAmout,
            },
          ),
      ).revertedWith('not enough funds');

      afterEthBalance1 = await provider.getBalance(payee1);
      expect(afterEthBalance1).to.be.equal(beforeEthBalance1);

      afterEthBalance2 = await provider.getBalance(payee2);
      expect(afterEthBalance2).to.be.equal(beforeEthBalance2);

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });

    it('Should revert batch if not enough funds for the batch fee', async function () {
      beforeEthBalance1 = await provider.getBalance(payee1);
      beforeEthBalance2 = await provider.getBalance(payee2);

      const totalAmout = BigNumber.from('530'); // missing 5 (= (200+300) * 1%)

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [200, 300],
            [referenceExample1, referenceExample2],
            [10, 20],
            feeAddress,
            {
              value: totalAmout,
            },
          ),
      ).revertedWith('not enough funds');

      afterEthBalance1 = await provider.getBalance(payee1);
      expect(afterEthBalance1).to.be.equal(beforeEthBalance1);

      afterEthBalance2 = await provider.getBalance(payee2);
      expect(afterEthBalance2).to.be.equal(beforeEthBalance2);

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });

    it('Should revert batch if input s arrays do not have same size', async function () {
      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [5, 30],
            [referenceExample1, referenceExample2],
            [1],
            feeAddress,
          ),
      ).revertedWith('the input arrays must have the same length');

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1],
            [5, 30],
            [referenceExample1, referenceExample2],
            [1, 2],
            feeAddress,
          ),
      ).revertedWith('the input arrays must have the same length');

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [5],
            [referenceExample1, referenceExample2],
            [1, 2],
            feeAddress,
          ),
      ).revertedWith('the input arrays must have the same length');

      await expect(
        batch
          .connect(owner)
          .batchEthPaymentsWithReference(
            [payee1, payee2],
            [5, 30],
            [referenceExample1],
            [1, 2],
            feeAddress,
          ),
      ).revertedWith('the input arrays must have the same length');

      expect(await provider.getBalance(batchAddress)).to.be.equal(0);
    });
  });

  describe('Function allowed only to the owner', () => {
    it('Should allow the owner to update batchFee', async function () {
      const beforeBatchFee = await batch.batchFee.call({ from: owner });
      let tx = await batch.connect(owner).setBatchFee(beforeBatchFee.add(10));
      await tx.wait();
      const afterBatchFee = await batch.batchFee.call({ from: owner });
      expect(afterBatchFee).to.be.equal(beforeBatchFee.add(10));
    });

    it('Should applied the new batchFee', async function () {
      // check if batch fee applied are the one updated
      const beforeFeeAddress = await provider.getBalance(feeAddress);

      const tx = await batch
        .connect(owner)
        .batchEthPaymentsWithReference(
          [payee1, payee2],
          [200, 300],
          [referenceExample1, referenceExample2],
          [10, 20],
          feeAddress,
          {
            value: BigNumber.from('1000'),
          },
        );
      await tx.wait();

      const afterFeeAddress = await provider.getBalance(feeAddress);
      expect(afterFeeAddress).to.be.equal(beforeFeeAddress.add(10 + 20 + (4 + 6))); // fee: (10+20), batch fee: (4+6)
    });

    it('Should revert if it is not the owner that try to update batchFee', async function () {
      await expect(batch.connect(payee1Sig).setBatchFee(30)).revertedWith(
        'revert Ownable: caller is not the owner',
      );
    });
  });
});

// Allow to create easly BatchPayments input, especially for gas optimization.
const getBatchPaymentsInputs = function (
  nbTxs: number,
  tokenAddress: string,
  recipient: string,
  amount: number,
  referenceExample1: string,
  feeAmount: number,
): [Array<string>, Array<string>, Array<number>, Array<string>, Array<number>] {
  let tokenAddresses = [];
  let recipients = [];
  let amounts = [];
  let paymentReferences = [];
  let feeAmounts = [];

  for (let i = 0; i < nbTxs; i++) {
    tokenAddresses.push(tokenAddress);
    recipients.push(recipient);
    amounts.push(amount);
    paymentReferences.push(referenceExample1);
    feeAmounts.push(feeAmount);
  }
  return [tokenAddresses, recipients, amounts, paymentReferences, feeAmounts];
};
