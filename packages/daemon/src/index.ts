export { startDaemon, DaemonStartError } from './server.js';
export type { DaemonStatus, DaemonHandle, DaemonOptions } from './server.js';
export { connectOrSpawn, connectRawSocket, connectDaemon, probeDaemon, RpcCallError, DaemonUnavailableError } from './client.js';
export type { RpcClient, ConnectOptions } from './client.js';
export { daemonSocketPath, socketAlive, cleanStaleSocket } from './socket.js';
export type { WebHost, WebHostServer, WebHostStatus, WebStartParams } from './web.js';
export { createEventsHost, eventsSubscribeError, type EventsHost, type EventsSubscribeParams } from './events.js';
export { bridgeStdio, type BridgeOptions } from './bridge.js';
