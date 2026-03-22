import type {
  LocalCryptoDeviceMaterial,
  LocalCryptoDeviceRecord,
} from "./types";

const databaseName = "aerochat-crypto-runtime";
const databaseVersion = 1;
const metadataStoreName = "crypto-device-metadata";
const keysStoreName = "crypto-device-keys";

const identityPublicKeyName = "identity-public";
const identityPrivateKeyName = "identity-private";
const signedPrekeyPublicKeyName = "signed-prekey-public";
const signedPrekeyPrivateKeyName = "signed-prekey-private";

export interface CryptoKeyStore {
  isSupported(): boolean;
  load(accountId: string): Promise<LocalCryptoDeviceMaterial | null>;
  save(material: LocalCryptoDeviceMaterial): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export function createBrowserCryptoKeyStore(): CryptoKeyStore {
  return {
    isSupported() {
      return typeof indexedDB !== "undefined";
    },

    async load(accountId) {
      const database = await openDatabase();

      try {
        const transaction = database.transaction(
          [metadataStoreName, keysStoreName],
          "readonly",
        );
        const metadataStore = transaction.objectStore(metadataStoreName);
        const keysStore = transaction.objectStore(keysStoreName);
        const record = (await requestToPromise(
          metadataStore.get(accountId),
        )) as LocalCryptoDeviceRecord | undefined;

        if (record === undefined) {
          await transactionDone(transaction);
          return null;
        }

        const identityPublicKey = (await requestToPromise(
          keysStore.get(buildKeyID(accountId, identityPublicKeyName)),
        )) as CryptoKey | undefined;
        const identityPrivateKey = (await requestToPromise(
          keysStore.get(buildKeyID(accountId, identityPrivateKeyName)),
        )) as CryptoKey | undefined;
        const signedPrekeyPublicKey = (await requestToPromise(
          keysStore.get(buildKeyID(accountId, signedPrekeyPublicKeyName)),
        )) as CryptoKey | undefined;
        const signedPrekeyPrivateKey = (await requestToPromise(
          keysStore.get(buildKeyID(accountId, signedPrekeyPrivateKeyName)),
        )) as CryptoKey | undefined;

        await transactionDone(transaction);

        if (
          identityPublicKey === undefined ||
          identityPrivateKey === undefined ||
          signedPrekeyPublicKey === undefined ||
          signedPrekeyPrivateKey === undefined
        ) {
          throw new Error(
            "Локальное crypto-хранилище повреждено: отсутствует часть key material.",
          );
        }

        return {
          record,
          identityPublicKey,
          identityPrivateKey,
          signedPrekeyPublicKey,
          signedPrekeyPrivateKey,
        };
      } finally {
        database.close();
      }
    },

    async save(material) {
      const database = await openDatabase();

      try {
        const transaction = database.transaction(
          [metadataStoreName, keysStoreName],
          "readwrite",
        );
        const metadataStore = transaction.objectStore(metadataStoreName);
        const keysStore = transaction.objectStore(keysStoreName);

        metadataStore.put(material.record, material.record.accountId);
        keysStore.put(
          material.identityPublicKey,
          buildKeyID(material.record.accountId, identityPublicKeyName),
        );
        keysStore.put(
          material.identityPrivateKey,
          buildKeyID(material.record.accountId, identityPrivateKeyName),
        );
        keysStore.put(
          material.signedPrekeyPublicKey,
          buildKeyID(material.record.accountId, signedPrekeyPublicKeyName),
        );
        keysStore.put(
          material.signedPrekeyPrivateKey,
          buildKeyID(material.record.accountId, signedPrekeyPrivateKeyName),
        );

        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },

    async delete(accountId) {
      const database = await openDatabase();

      try {
        const transaction = database.transaction(
          [metadataStoreName, keysStoreName],
          "readwrite",
        );
        const metadataStore = transaction.objectStore(metadataStoreName);
        const keysStore = transaction.objectStore(keysStoreName);

        metadataStore.delete(accountId);
        keysStore.delete(buildKeyID(accountId, identityPublicKeyName));
        keysStore.delete(buildKeyID(accountId, identityPrivateKeyName));
        keysStore.delete(buildKeyID(accountId, signedPrekeyPublicKeyName));
        keysStore.delete(buildKeyID(accountId, signedPrekeyPrivateKeyName));

        await transactionDone(transaction);
      } finally {
        database.close();
      }
    },
  };
}

function buildKeyID(accountId: string, keyName: string): string {
  return `${accountId}:${keyName}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    throw new Error("IndexedDB недоступен в текущем runtime.");
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, databaseVersion);

    request.onerror = () => {
      reject(request.error ?? new Error("Не удалось открыть IndexedDB keystore."));
    };

    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(metadataStoreName)) {
        database.createObjectStore(metadataStoreName);
      }

      if (!database.objectStoreNames.contains(keysStoreName)) {
        database.createObjectStore(keysStoreName);
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => {
      reject(request.error ?? new Error("IndexedDB request failed."));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.onerror = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    };
    transaction.onabort = () => {
      reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    };
    transaction.oncomplete = () => {
      resolve();
    };
  });
}
