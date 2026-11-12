import { AppDialog } from "components/dialogs/AppDialog";
import { Button } from "components/ui/button";
import { useClipboard } from "hooks/useClipboard";
import { Check, Copy, Download } from "lucide-react";
import { useTranslation } from "react-i18next";

type NodeInstallBundleDialogProps = {
	name?: string | null;
	certificate: string;
	certificateKey?: string | null;
	onClose: () => void;
};

const buildInstallBundle = (certificate: string, certificateKey?: string | null) => {
	const key = certificateKey?.trim() ?? "";
	const cert = certificate.trim();
	return key ? `${cert}\n${key}\n` : cert;
};

export const NodeInstallBundleDialog = ({
	name,
	certificate,
	certificateKey,
	onClose,
}: NodeInstallBundleDialogProps) => {
	const { t } = useTranslation();
	const bundle = buildInstallBundle(certificate, certificateKey);
	const { onCopy, hasCopied } = useClipboard(bundle);

	const handleDownload = () => {
		const url = URL.createObjectURL(new Blob([bundle], { type: "text/plain" }));
		const anchor = document.createElement("a");
		anchor.href = url;
		anchor.download = "node_install_bundle.pem";
		anchor.click();
		URL.revokeObjectURL(url);
	};

	return (
		<AppDialog
			open
			onClose={onClose}
			size="lg"
			title={t("nodes.newNodePublicKeyTitle")}
			footer={<Button onClick={onClose}>{t("close")}</Button>}
		>
			<div className="flex flex-col gap-3">
				<p className="text-sm text-muted-foreground">{t("nodes.newNodePublicKeyDesc")}</p>
				<div className="overflow-hidden rounded-lg border">
					<div className="flex items-center justify-between gap-3 border-b bg-muted/50 px-3 py-2">
						<p className="text-sm font-medium">{t("nodes.installBundleLabel")}</p>
						{name ? <p className="min-w-0 truncate font-mono text-xs text-muted-foreground" dir="ltr">{name}</p> : null}
					</div>
					<div className="grid grid-cols-1 gap-2 border-b p-2 sm:grid-cols-2">
						<Button variant="outline" size="sm" onClick={onCopy} className="w-full">
							{hasCopied ? <Check /> : <Copy />}
							{hasCopied ? t("copied") : t("copy")}
						</Button>
						<Button variant="outline" size="sm" onClick={handleDownload} className="w-full">
							<Download />
							{t("nodes.download-node-install-bundle")}
						</Button>
					</div>
					<pre
						dir="ltr"
						className="max-h-44 overflow-auto whitespace-pre bg-background p-3 font-mono text-[11px] leading-5"
					>
						{bundle}
					</pre>
				</div>
			</div>
		</AppDialog>
	);
};
