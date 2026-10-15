import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupCallAwarenessEntry } from "./group-awareness";
import { selectOwnedGroupLobbyCallId, startGroupLobbyHeartbeat } from "./group-lobby-heartbeat";

afterEach(() => vi.useRealTimers());

describe("group lobby heartbeat ownership", () => {
  const entry: GroupCallAwarenessEntry = {
    groupId: "group-1", syncStatus: "ready", errorMessage: null,
    call: {id:"call-1",scope:{kind:"group",groupId:"group-1",directChatId:null},createdByUserId:"user-1",status:"active",activeParticipantCount:1,createdAt:"now",startedAt:"now",updatedAt:"now",endedAt:null,endedByUserId:null,endReason:"unspecified"},
    participants:[{id:"participant-1",callId:"call-1",userId:"user-1",state:"active",joinedAt:"now",updatedAt:"now",leftAt:null,lastSignalAt:null}],
  };
  const ownership = {callId:"call-1",groupId:"group-1",userId:"user-1"};
  it("requires a successful local join plus active self roster and eligible current role", () => {
    const input = {ownership,entry,currentUserId:"user-1",selfRole:"member" as const};
    expect(selectOwnedGroupLobbyCallId(input)).toBe("call-1");
    expect(selectOwnedGroupLobbyCallId({...input,ownership:null})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,currentUserId:"other-user"})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,selfRole:"reader"})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,entry:{...entry,participants:[]}})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,entry:{...entry,call:{...entry.call,status:"ended"}}})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,ownership:{...ownership,callId:"stale-call"}})).toBeNull();
    expect(selectOwnedGroupLobbyCallId({...input,entry:{...entry,call:{...entry.call,scope:{...entry.call.scope,groupId:"other-group"}}}})).toBeNull();
  });
});

describe("bounded group lobby heartbeat controller", () => {
  it("schedules ten own participant touches over 180 seconds and stops on disposal", async () => {
    vi.useFakeTimers();
    const touch = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();const onFailure = vi.fn();
    const stop = startGroupLobbyHeartbeat({touch,onSuccess,onFailure});
    await vi.advanceTimersByTimeAsync(180_000);
    expect(touch).toHaveBeenCalledTimes(10);
    expect(onSuccess).toHaveBeenCalledTimes(10);
    expect(onFailure).not.toHaveBeenCalled();
    stop();await vi.advanceTimersByTimeAsync(100_000);
    expect(touch).toHaveBeenCalledTimes(10);
  });
  it.each([false,true])("serializes requests and ignores late completion after cleanup (reject=%s)", async reject => {
    vi.useFakeTimers();
    let complete!: () => void;
    const touch = vi.fn(()=>new Promise<void>((resolve,rejectPromise)=>{complete=()=>reject?rejectPromise(new Error("offline")):resolve();}));
    const onSuccess=vi.fn();const onFailure=vi.fn();
    const stop=startGroupLobbyHeartbeat({touch,onSuccess,onFailure});
    await vi.advanceTimersByTimeAsync(100_000);
    expect(touch).toHaveBeenCalledTimes(1);
    stop();complete();await vi.advanceTimersByTimeAsync(100_000);
    expect(touch).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();expect(onFailure).not.toHaveBeenCalled();
  });
  it("surfaces transient failure and recovers on the next bounded heartbeat", async () => {
    vi.useFakeTimers();
    const touch=vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const onSuccess=vi.fn();const onFailure=vi.fn();
    const stop=startGroupLobbyHeartbeat({touch,onSuccess,onFailure});
    await vi.advanceTimersByTimeAsync(20_000);
    expect(onFailure).toHaveBeenCalledTimes(1);expect(onSuccess).toHaveBeenCalledTimes(1);
    stop();
  });
});
