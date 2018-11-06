import Utils from '@requestnetwork/utils';
import * as RequestEnum from './enum';
import Request from './request';
import Transaction from './transaction';
import * as Types from './types';

import AcceptAction from './actions/accept';
import CreateAction from './actions/create';

/**
 * Implementation of the request logic specification
 */
export default {
  applyTransactionToRequest,
  formatAccept: AcceptAction.format,
  formatCreate: CreateAction.format,
};

/**
 * Function Entry point to apply any signed transaction to a request
 *
 * @param Types.IRequestLogicSignedTransaction signedTransaction The signed transaction to apply
 * @param Types.IRequestLogicRequest request The request before update - will not be modified
 *
 * @returns Types.IRequestLogicRequest  The request updated
 */
function applyTransactionToRequest(
  signedTransaction: Types.IRequestLogicSignedTransaction,
  request?: Types.IRequestLogicRequest,
): Types.IRequestLogicRequest {
  if (!Transaction.isSignedTransactionVersionSupported(signedTransaction)) {
    throw new Error('signed transaction version not supported');
  }

  // we don't want to modify the original request state
  const requestCopied: Types.IRequestLogicRequest | null = request
    ? Utils.deepCopy(request)
    : null;

  // Creation request
  if (signedTransaction.transaction.action === RequestEnum.REQUEST_LOGIC_ACTION.CREATE) {
    if (requestCopied) {
      throw new Error('no request is expected at the creation');
    }
    return CreateAction.createRequest(signedTransaction);
  }

  // Update request
  if (!requestCopied) {
    throw new Error('request is expected');
  }

  // Will throw if the request is not valid
  Request.checkRequest(requestCopied);

  if (signedTransaction.transaction.action === RequestEnum.REQUEST_LOGIC_ACTION.ACCEPT) {
    return AcceptAction.applyTransactionToRequest(signedTransaction, requestCopied);
  }

  throw new Error('Unknown action ${signedTransaction.transaction.action}');
}
