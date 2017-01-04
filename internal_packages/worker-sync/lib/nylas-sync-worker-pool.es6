import _ from 'underscore';
import {AccountStore, Actions} from 'nylas-exports'
import NylasSyncWorker from './nylas-sync-worker';

export default class NylasSyncWorkerPool {
  constructor() {
    this._workers = [];
    AccountStore.listen(this._determineWorkerPool, this);
    this._determineWorkerPool();
    Actions.refreshAllSyncWorkers.listen(this._refreshAllWorkers, this)
  }

  _refreshAllWorkers() {
    for (const worker of this._workers) {
      worker.refresh()
    }
  }

  _existingWorkerForAccount(account) {
    return _.find(this._workers, c => c.account().id === account.id);
  }

  _determineWorkerPool() {
    // we need a function lock on this because on bootup, many legitimate
    // events coming in may result in this function being called multiple times
    // in quick succession, which can cause us to start multiple syncs for the
    // same account
    if (this._isBuildingWorkers) return;
    this._isBuildingWorkers = true;
    if (NylasEnv.inSpecMode()) { return; }
    const origWorkers = this._workers;
    const currentWorkers = []
    Promise.each(AccountStore.accounts(), (account) => {
      const existingWorker = this._existingWorkerForAccount(account)
      if (existingWorker) {
        currentWorkers.push(existingWorker);
        return Promise.resolve()
      }

      const newWorker = new NylasSyncWorker(account);
      return newWorker.loadStateFromDatabase().then(() => {
        newWorker.start()
        currentWorkers.push(newWorker);
      })
    }).then(() => {
      const oldWorkers = _.difference(origWorkers, currentWorkers);
      for (const worker of oldWorkers) { worker.cleanup() }
      this._workers = currentWorkers;
    }).finally(() => {
      this._isBuildingWorkers = false;
    })
  }
}