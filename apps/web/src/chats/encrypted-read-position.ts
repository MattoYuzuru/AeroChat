import type { EncryptedConversationReadPosition } from "../gateway/types";
import { compareServerSequences, requireServerSequence } from "../gateway/server-sequence";

export function isEncryptedMessageReadByPeer(
  entry: { serverSequence: string },
  peerReadPosition: Pick<EncryptedConversationReadPosition, "lastReadServerSequence"> | null,
): boolean {
  return peerReadPosition !== null &&
    compareServerSequences(requireServerSequence(entry.serverSequence), requireServerSequence(peerReadPosition.lastReadServerSequence)) <= 0;
}
