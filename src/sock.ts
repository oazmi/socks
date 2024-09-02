/** contains the core class ({@link Sock}) that simplifies two way communication in a websocket.
 * 
 * @module
*/

import { promise_outside } from "./deps.ts"
import { log } from "./funcdefs.ts"
import type { SockJsonMessage } from "./typedefs.ts"


/** a wrapper class for websockets that makes it easy to design two way communication in terms of handler functions.
 * @typeParam B specify the binary data type used by your websocket for received binary messages. this can be set via `your_websocket.binaryType`.
*/
export class Sock<B extends ArrayBuffer | Blob = Blob> {
	/** the underlying websocket for which this wrapper is for. */
	readonly socket: WebSocket

	/** a collection of all json message receiving handlers, identified by their `kind` (key). */
	protected jsonReceivers: { [kind: string]: <M extends SockJsonMessage>(sock: Sock<any>, message: M) => void } = {}

	/** a collection of all binary message receiving handlers, identified by their `kind` (key). */
	protected binaryReceivers: { [kind: string]: (sock: Sock<B>, data: B) => void } = {}

	/** the current `kind` of all upcoming binary data messages. */
	protected binaryReceiverNextKind?: string // == keyof this["binaryReceivers"], but since `binaryReceivers` is a protected member, we can't do that.

	constructor(socket: WebSocket) {
		this.socket = socket
		const { jsonReceivers, binaryReceivers } = this
		socket.addEventListener("message", (event: MessageEvent) => {
			const data = event.data
			if (typeof data === "string") {
				const message = JSON.parse(data) as SockJsonMessage
				jsonReceivers[message.kind](this, message)
			} else {
				const kind = this.binaryReceiverNextKind as string
				// I had originally planned that every binary received data must be accompannied by a json prior to it.
				// although it would have been a good design, I don't think I want the communication to be that verbose.
				// thus we will continue to hold on to the most recent binary kind.
				// this.binaryReceiverNextKind = undefined // set the binary kind to undefined, to ensure that the user manually set the next kind based on received json messages
				
				// TODO: implement a stack of binary `kind`s, so that the end user can simply push a new state when they wish to process a certain kind of binary data,
				//       and at the end, they can pop the state once they are done with that specific form of communication.
				binaryReceivers[kind](this, data)
			}
		})
	}

	/** send an object as a json encoded message. */
	sendJson<M extends SockJsonMessage>(message: M) {
		this.socket.send(JSON.stringify(message))
	}

	/** send raw binary data in the form of your chosen binary kind {@link B} (either `Blob` (default) or `ArrayBuffer`) */
	sendBinary(data: ArrayBufferLike | Blob | ArrayBufferView) {
		this.socket.send(data)
	}

	/** add a json message handling function, based on the json message's `kind` filed (see {@link SockJsonMessage}). */
	addJsonReceiver<M extends SockJsonMessage>(kind: string, handler: (sock: Sock<any>, message: M) => void) {
		this.jsonReceivers[kind] = handler as any
	}

	/** add a binary data handling function, identified by its {@link kind}.
	 * use {@link expectBinaryKind} to set the `kind` of the next anticipated incoming packets of binary data.
	*/
	addBinaryReceiver(kind: string, handler: (sock: Sock<B>, data: B) => void) {
		this.binaryReceivers[kind] = handler
	}

	/** set the `kind` of upcoming binary data messages received, so that they are routed to the correct handler function in {@link binaryReceivers}. */
	expectBinaryKind(kind: string) {
		this.binaryReceiverNextKind = kind
	}

	/** get the current expectation `kind` of upcoming received binary data messages. */
	getBinaryKind() {
		return this.binaryReceiverNextKind
	}

	/** a static method to create a {@link Sock} (websocket wrapper) that has its connection established (i.e. `websocket.readyState === websocket.OPEN`),
	 * so that you will not have to test for connectivity in every piece of websocket code.
	*/
	static async create<B extends ArrayBuffer | Blob = Blob>(websocket: WebSocket): Promise<Sock<B>> {
		log("establishing socket")
		const [ready, ready_resolver, ready_rejector] = promise_outside()
		switch (websocket.readyState) {
			case websocket.OPEN: { ready_resolver!(true); break }
			case websocket.CONNECTING: {
				websocket.addEventListener("open", () => ready_resolver!(true))
				break
			}
			default: { ready_rejector!() }
		}
		await ready
		return new this(websocket)
	}
}
