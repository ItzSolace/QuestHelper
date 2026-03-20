/* vencord thingy
*/

import { definePluginSettings } from "@api/Settings";
import definePlugin, { OptionType } from "@utils/types";

const settings = definePluginSettings({
    autoAcceptQuests: {
        type: OptionType.BOOLEAN,
        description: "Automatically enroll in newly available quests",
        default: false,
        restartNeeded: false
    },
    logProgress: {
        type: OptionType.BOOLEAN,
        description: "Show quest progress in console",
        default: true,
        restartNeeded: false
    }
});

const TASK_TYPES = ["WATCH_VIDEO", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "WATCH_VIDEO_ON_MOBILE"];

interface QuestTask {
    target: number;
}

interface TaskConfig {
    tasks: Record<string, QuestTask>;
}

interface QuestConfig {
    taskConfig?: TaskConfig;
    taskConfigV2?: TaskConfig;
    expiresAt: string;
    application: { id: string; name: string };
    messages: { questName: string };
    configVersion?: number;
}

interface Quest {
    id: string;
    config: QuestConfig;
    userStatus?: {
        enrolledAt?: string;
        completedAt?: string;
        progress?: Record<string, { value: number }>;
        streamProgressSeconds?: number;
    };
}

let ApplicationStreamingStore: any;
let RunningGameStore: any;
let QuestsStore: any;
let ChannelStore: any;
let GuildChannelStore: any;
let FluxDispatcher: any;
let api: any;
let isDesktopApp: boolean;

let isReady = false;
let isProcessing = false;
let questList: Quest[] = [];
let pollTimer: ReturnType<typeof setInterval> | null = null;
let unsubscribers: (() => void)[] = [];
let sessionActive = false;

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

function debug(...args: any[]) {
    if (settings.store.logProgress) {
        console.log("[QuestHelper]", ...args);
    }
}

function getTaskInfo(quest: Quest): TaskConfig | undefined {
    return quest.config.taskConfig ?? quest.config.taskConfigV2;
}

function canComplete(quest: Quest): boolean {
    if (new Date(quest.config.expiresAt).getTime() <= Date.now()) return false;
    const tasks = getTaskInfo(quest)?.tasks;
    if (!tasks) return false;
    return TASK_TYPES.some(t => tasks[t] != null);
}

function hasJoined(quest: Quest): boolean {
    return !!quest.userStatus?.enrolledAt;
}

function isDone(quest: Quest): boolean {
    return !!quest.userStatus?.completedAt;
}

function locateStores(): boolean {
    if (isReady) return true;

    try {
        const wpRequire = (window as any).webpackChunkdiscord_app.push([[Symbol()], {}, (r: any) => r]);
        (window as any).webpackChunkdiscord_app.pop();
        const modules = Object.values(wpRequire.c) as any[];

        ApplicationStreamingStore = modules.find((x: any) =>
            x?.exports?.Z?.__proto__?.getStreamerActiveStreamMetadata
        )?.exports?.Z;

        if (!ApplicationStreamingStore) {
            ApplicationStreamingStore = modules.find((x: any) =>
                x?.exports?.A?.__proto__?.getStreamerActiveStreamMetadata
            )?.exports?.A;
            RunningGameStore  = modules.find((x: any) => x?.exports?.Ay?.getRunningGames)?.exports?.Ay;
            QuestsStore       = modules.find((x: any) => x?.exports?.A?.__proto__?.getQuest)?.exports?.A;
            ChannelStore      = modules.find((x: any) => x?.exports?.A?.__proto__?.getAllThreadsForParent)?.exports?.A;
            GuildChannelStore = modules.find((x: any) => x?.exports?.Ay?.getSFWDefaultChannel)?.exports?.Ay;
            FluxDispatcher    = modules.find((x: any) => x?.exports?.h?.__proto__?.flushWaitQueue)?.exports?.h;
            api               = modules.find((x: any) => x?.exports?.Bo?.get)?.exports?.Bo;
        } else {
            RunningGameStore  = modules.find((x: any) => x?.exports?.ZP?.getRunningGames)?.exports?.ZP;
            QuestsStore       = modules.find((x: any) => x?.exports?.Z?.__proto__?.getQuest)?.exports?.Z;
            ChannelStore      = modules.find((x: any) => x?.exports?.Z?.__proto__?.getAllThreadsForParent)?.exports?.Z;
            GuildChannelStore = modules.find((x: any) => x?.exports?.ZP?.getSFWDefaultChannel)?.exports?.ZP;
            FluxDispatcher    = modules.find((x: any) => x?.exports?.Z?.__proto__?.flushWaitQueue)?.exports?.Z;
            api               = modules.find((x: any) => x?.exports?.tn?.get)?.exports?.tn;
        }

        if (!QuestsStore || !FluxDispatcher || !api) {
            console.error("[QuestHelper] Could not locate required modules");
            return false;
        }

        isDesktopApp = typeof (window as any).DiscordNative !== "undefined";
        isReady = true;
        debug("Modules loaded, desktop:", isDesktopApp);
        return true;
    } catch (e) {
        console.error("[QuestHelper] Initialization error:", e);
        return false;
    }
}

async function joinQuest(quest: Quest): Promise<boolean> {
    const questTitle = quest.config.messages.questName;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await api.post({
                url: `/quests/${quest.id}/enroll`,
                body: {
                    location: 11,
                    is_targeted: false,
                    metadata_raw: null,
                    metadata_sealed: null,
                    traffic_metadata_raw: null
                }
            });

            if (res?.status === 429) {
                const delay = ((res.body?.retry_after ?? 5) + 1) * 1000;
                debug(`Rate limited on "${questTitle}" (${attempt}/${maxAttempts}) - waiting ${Math.ceil(delay / 1000)}s...`);
                if (attempt < maxAttempts) await wait(delay);
                continue;
            }

            debug(`Enrolled: ${questTitle}`);
            return true;

        } catch (e: any) {
            const status: number = e?.status ?? e?.res?.status ?? 0;
            const body: any = e?.body ?? e?.res?.body ?? {};

            if (status === 429) {
                const delay = ((body?.retry_after ?? 5) + 1) * 1000;
                debug(`Rate limited on "${questTitle}" (${attempt}/${maxAttempts}) - waiting ${Math.ceil(delay / 1000)}s...`);
                if (attempt < maxAttempts) await wait(delay);
                continue;
            }

            debug(`Could not enroll "${questTitle}" (${status}):`, body?.message ?? e);
            return false;
        }
    }

    debug(`Enrollment failed for "${questTitle}" after ${maxAttempts} attempts`);
    return false;
}

async function autoJoinQuests(): Promise<boolean> {
    if (!settings.store.autoAcceptQuests) return false;
    if (!QuestsStore?.quests) return false;

    const pending = [...QuestsStore.quests.values()].filter(q =>
        !hasJoined(q) && !isDone(q) && canComplete(q)
    );

    if (pending.length === 0) return false;

    debug(`Auto-joining ${pending.length} quest(s)...`);
    let anyJoined = false;

    for (const q of pending) {
        const success = await joinQuest(q);
        if (success) anyJoined = true;
        await wait(3000);
    }

    return anyJoined;
}

function updateQuestList() {
    if (!QuestsStore?.quests) return;

    const active = [...QuestsStore.quests.values()].filter(q =>
        hasJoined(q) && !isDone(q) && canComplete(q)
    );

    let newCount = 0;
    for (const quest of active) {
        if (!questList.find(q => q.id === quest.id)) {
            questList.push(quest);
            newCount++;
            debug(`Added to list: ${quest.config.messages.questName}`);
        }
    }

    if (newCount > 0) debug(`${newCount} quest(s) added (total: ${questList.length})`);

    if (!isProcessing && questList.length > 0) {
        debug("Starting quest processor...");
        processNextQuest();
    }
}

async function checkForNewQuests() {
    if (!isReady) return;
    const joined = await autoJoinQuests();
    if (joined) await wait(1500);
    updateQuestList();
}

function beginSession() {
    if (sessionActive) return;
    sessionActive = true;

    isReady = false;
    isProcessing = false;
    questList = [];

    if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
    }

    setTimeout(async () => {
        sessionActive = false;
        if (!locateStores()) return;

        try {
            debug("Fetching quest data...");
            await api.get({ url: "/quests/@me" });
            debug("Quest data retrieved");
        } catch (e) {
            debug("Could not fetch quests (will retry):", e);
        }

        pollTimer = setInterval(() => checkForNewQuests(), 60_000);
        checkForNewQuests();
    }, 2000);
}

function processNextQuest() {
    const quest = questList.shift();
    if (!quest) {
        isProcessing = false;
        debug("All quests processed.");
        return;
    }

    isProcessing = true;

    const fakePid = Math.floor(Math.random() * 30000) + 1000;
    const appId = quest.config.application.id;
    const appName = quest.config.application.name;
    const questTitle = quest.config.messages.questName;
    const taskData = getTaskInfo(quest);
    const taskType = TASK_TYPES.find(x => taskData?.tasks[x] != null)!;
    const targetTime = taskData!.tasks[taskType].target;
    let currentProgress = quest.userStatus?.progress?.[taskType]?.value ?? 0;

    if (taskType === "WATCH_VIDEO" || taskType === "WATCH_VIDEO_ON_MOBILE") {
        const speed = 7;
        const maxFuture = 10;
        const interval = 1;
        const startTime = new Date(quest.userStatus!.enrolledAt!).getTime();
        let finished = false;

        (async () => {
            try {
                while (true) {
                    const maxAllowed = Math.floor((Date.now() - startTime) / 1000) + maxFuture;
                    const remaining = maxAllowed - currentProgress;
                    const timestamp = currentProgress + speed;

                    if (remaining >= speed) {
                        const res = await api.post({
                            url: `/quests/${quest.id}/video-progress`,
                            body: { timestamp: Math.min(targetTime, timestamp + Math.random()) }
                        });
                        finished = res.body.completed_at != null;
                        currentProgress = Math.min(targetTime, timestamp);
                    }

                    if (timestamp >= targetTime) break;
                    await wait(interval * 1000);
                }

                if (!finished) {
                    await api.post({
                        url: `/quests/${quest.id}/video-progress`,
                        body: { timestamp: targetTime }
                    });
                }

                debug(`Done: ${questTitle}`);
            } catch (e) {
                debug(`Error with "${questTitle}":`, e);
            }
            processNextQuest();
        })();

        debug(`Watching video: ${questTitle}`);

    } else if (taskType === "PLAY_ON_DESKTOP") {
        if (!isDesktopApp) {
            debug(`${questTitle} requires desktop app - skipping`);
            processNextQuest();
            return;
        }

        api.get({ url: `/applications/public?application_ids=${appId}` })
            .then((res: any) => {
                const appInfo = res.body?.[0];

                if (!appInfo) {
                    debug(`No app data for "${questTitle}" - skipping`);
                    processNextQuest();
                    return;
                }

                const winExe = appInfo.executables?.find((x: any) => x.os === "win32");
                const anyExe = appInfo.executables?.[0];
                const exeName = (winExe ?? anyExe)?.name?.replace(">", "") ?? `${appInfo.name}.exe`;

                const fakeGameEntry = {
                    cmdLine: `C:\\Program Files\\${appInfo.name}\\${exeName}`,
                    exeName,
                    exePath: `c:/program files/${appInfo.name.toLowerCase()}/${exeName}`,
                    hidden: false,
                    isLauncher: false,
                    id: appId,
                    name: appInfo.name,
                    pid: fakePid,
                    pidPath: [fakePid],
                    processName: appInfo.name,
                    start: Date.now(),
                };

                const savedGames = RunningGameStore.getRunningGames();
                const origGetRunningGames = RunningGameStore.getRunningGames;
                const origGetGameForPID = RunningGameStore.getGameForPID;

                const restore = () => {
                    RunningGameStore.getRunningGames = origGetRunningGames;
                    RunningGameStore.getGameForPID = origGetGameForPID;
                    FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: [fakeGameEntry], added: [], games: [] });
                    FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handler);
                };

                RunningGameStore.getRunningGames = () => [fakeGameEntry];
                RunningGameStore.getGameForPID = (p: number) => (p === fakeGameEntry.pid ? fakeGameEntry : undefined);
                FluxDispatcher.dispatch({ type: "RUNNING_GAMES_CHANGE", removed: savedGames, added: [fakeGameEntry], games: [fakeGameEntry] });

                const handler = (data: any) => {
                    try {
                        const progress = quest.config.configVersion === 1
                            ? data.userStatus.streamProgressSeconds
                            : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);

                        debug(`[${questTitle}] ${progress}/${targetTime}`);

                        if (progress >= targetTime) {
                            debug(`Completed: ${questTitle}`);
                            restore();
                            processNextQuest();
                        }
                    } catch (e) {
                        debug(`Handler error for "${questTitle}":`, e);
                        restore();
                        processNextQuest();
                    }
                };

                FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handler);
                debug(`Playing game: ${appName} (~${Math.ceil((targetTime - currentProgress) / 60)} min)`);
            })
            .catch((e: any) => {
                debug(`Failed to get app data for "${questTitle}":`, e);
                processNextQuest();
            });

    } else if (taskType === "STREAM_ON_DESKTOP") {
        if (!isDesktopApp) {
            debug(`${questTitle} requires desktop app - skipping`);
            processNextQuest();
            return;
        }

        const savedStreamer = ApplicationStreamingStore.getStreamerActiveStreamMetadata;

        const restore = () => {
            ApplicationStreamingStore.getStreamerActiveStreamMetadata = savedStreamer;
            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handler);
        };

        ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
            id: appId,
            pid: fakePid,
            sourceName: null
        });

        const handler = (data: any) => {
            try {
                const progress = quest.config.configVersion === 1
                    ? data.userStatus.streamProgressSeconds
                    : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);

                debug(`[${questTitle}] ${progress}/${targetTime}`);

                if (progress >= targetTime) {
                    debug(`Completed: ${questTitle}`);
                    restore();
                    processNextQuest();
                }
            } catch (e) {
                debug(`Handler error for "${questTitle}":`, e);
                restore();
                processNextQuest();
            }
        };

        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", handler);
        debug(`Streaming: ${appName} (~${Math.ceil((targetTime - currentProgress) / 60)} min)`);

    } else if (taskType === "PLAY_ACTIVITY") {
        const channelId =
            ChannelStore.getSortedPrivateChannels()[0]?.id ??
            (Object.values(GuildChannelStore.getAllGuilds()) as any[])
                .find((x: any) => x?.VOCAL?.length > 0)?.VOCAL[0]?.channel?.id;

        if (!channelId) {
            debug("No channel for PLAY_ACTIVITY - skipping");
            processNextQuest();
            return;
        }

        const streamKey = `call:${channelId}:1`;

        (async () => {
            try {
                debug(`Activity quest: ${questTitle}`);
                while (true) {
                    const res = await api.post({
                        url: `/quests/${quest.id}/heartbeat`,
                        body: { stream_key: streamKey, terminal: false }
                    });
                    const progress = res.body.progress.PLAY_ACTIVITY.value;
                    debug(`[${questTitle}] ${progress}/${targetTime}`);

                    if (progress >= targetTime) {
                        await api.post({
                            url: `/quests/${quest.id}/heartbeat`,
                            body: { stream_key: streamKey, terminal: true }
                        });
                        break;
                    }

                    await wait(20000);
                }
                debug(`Completed: ${questTitle}`);
            } catch (e) {
                debug(`Error with "${questTitle}":`, e);
            }
            processNextQuest();
        })();
    }
}

export default definePlugin({
    name: "QuestHelper",
    description: "Automatically accepts and completes Discord quests. Handles video watching, game playing, streaming, and activities.",
    authors: [{ name: "Solace", id: 1472732509241479218n }],
    settings,

    start() {
        debug("Starting QuestHelper...");

        const initFlux = (): any => {
            try {
                const wpRequire = (window as any).webpackChunkdiscord_app.push([[Symbol()], {}, (r: any) => r]);
                (window as any).webpackChunkdiscord_app.pop();
                const modules = Object.values(wpRequire.c as any[]) as any[];
                return (
                    modules.find((x: any) => x?.exports?.Z?.__proto__?.flushWaitQueue)?.exports?.Z ??
                    modules.find((x: any) => x?.exports?.h?.__proto__?.flushWaitQueue)?.exports?.h
                );
            } catch { return null; }
        };

        const earlyFlux = initFlux();
        if (!earlyFlux) {
            console.error("[QuestHelper] Could not initialize");
            return;
        }

        const onConnect = () => {
            debug("Connected - initializing...");
            beginSession();
        };

        const onStatusChange = () => {
            debug("Status changed - updating...");
            setTimeout(() => updateQuestList(), 500);
        };

        earlyFlux.subscribe("CONNECTION_OPEN", onConnect);
        earlyFlux.subscribe("QUEST_USER_STATUS_UPDATE", onStatusChange);

        unsubscribers = [
            () => earlyFlux.unsubscribe("CONNECTION_OPEN", onConnect),
            () => earlyFlux.unsubscribe("QUEST_USER_STATUS_UPDATE", onStatusChange),
        ];

        beginSession();
    },

    stop() {
        debug("Stopping QuestHelper...");

        for (const unsub of unsubscribers) unsub();
        unsubscribers = [];

        if (pollTimer !== null) {
            clearInterval(pollTimer);
            pollTimer = null;
        }

        questList = [];
        isProcessing = false;
        isReady = false;
        sessionActive = false;
    }
});
