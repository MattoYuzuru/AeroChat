export const gatewayClient = {
 listEncryptedDirectMessageV2: () => Promise.resolve(window.fixture.history()),
 listEncryptedGroupMessages: () => Promise.resolve(window.fixture.history()),
 getEncryptedGroupBootstrap: () => Promise.resolve({ groupId: 'scope-a' }),
};
