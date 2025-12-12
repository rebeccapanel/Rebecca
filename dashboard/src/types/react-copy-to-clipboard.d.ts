import type { ComponentType } from "react";

declare module "react-copy-to-clipboard" {
	const CopyToClipboard: ComponentType<any>;
	export default CopyToClipboard;
}
