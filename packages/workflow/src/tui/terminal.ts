import { ProcessTerminal } from "@mariozechner/pi-tui";

export class InterceptTerminal extends ProcessTerminal {
	private ctrlCHandler?: () => boolean;

	setCtrlCHandler(handler: () => boolean) {
		this.ctrlCHandler = handler;
	}

	override start(onInput: (data: string) => void, onResize: () => void): void {
		const wrappedInput = (data: string) => {
			if (data === "\x03" && this.ctrlCHandler?.()) {
				return;
			}
			onInput(data);
		};

		super.start(wrappedInput, onResize);
	}
}
