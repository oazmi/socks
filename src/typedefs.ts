import type { Sock } from "./sock.ts"

/** all json-encodable objects that can be sent or received via the {@link Sock} wrapper **must** extend this interface,
 * so that the messages can be identified through their {@link kind | `kind`} string.
*/
export interface SockJsonMessage {
	/** a string that provides information on the kind of websocket message this object is,
	 * so that it can be routed appropriately by a {@link Sock}.
	*/
	kind: string
}

/** this json-encodable object message is time-stamped with the time it was generated at.
 * the time information is often needed when measuring network performance, such as ping or when conducting speed tests.
 * you can either stick to `performance.now()` or `Date.now()` for time-stamping throughout your websocket communication,
 * but I recommend `performance.now()` when measuring network quality metrics.
*/
export interface SockJsonTimedMessage extends SockJsonMessage {
	/** a time-stamp on the object message, indicating the time when it was generated (or sent).
	 * you can either pick the built-in `performance.now()` or `Date.now()` for time stamping.
	*/
	time: number
}
