import { toast } from "components/ui/sonner";
import { Button } from "components/ui/button";
import { Input } from "components/ui/input";
import { Spinner } from "components/ui/spinner";
import { Plus, Pencil, Trash2, Users, Zap, Briefcase } from "lucide-react";

import { AppDialog } from "components/dialogs/AppDialog";
import { ConfirmDialog } from "components/dialogs/ConfirmDialog";
import {
	DataTable,
	type DataTableColumn,
	type DataTableRowAction,
	PageHeader,
	TabSystem,
} from "components/ui";
import { FormField } from "components/ui/form-field";
import { useAdminsStore } from "contexts/AdminsContext";
import { useDashboard } from "contexts/DashboardContext";
import useGetUser from "hooks/useGetUser";
import { type FC, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";
import { getAPIErrorMessage } from "service/http";
import {
	createGroup,
	deleteGroup,
	type GroupEntityType,
	type LabelGroup,
	renameGroup,
	useGroups,
	useInvalidateLabels,
} from "service/labels";
import { AdminRole } from "types/Admin";

const GroupsPage: FC = () => {
	const { t, i18n } = useTranslation();
	const navigate = useNavigate();
	const location = useLocation();
	const { userData } = useGetUser();
	const invalidateLabels = useInvalidateLabels();
	const isGlobal =
		userData.role === AdminRole.Sudo || userData.role === AdminRole.FullAccess;
	const isFullAccess = userData.role === AdminRole.FullAccess;
	const canViewAdminGroups =
		isFullAccess || Boolean(userData.permissions?.admin_management?.can_view);
	const canManageAdminGroups =
		isFullAccess || Boolean(userData.permissions?.admin_management?.can_edit);

	const hashType = location.hash.replace(/^#/, "");
	const activeType: GroupEntityType =
		hashType === "admins" && canViewAdminGroups ? "admin" : "user";
	const canManage = activeType === "user" ? isGlobal : canManageAdminGroups;

	const { data: groups = [], isLoading } = useGroups(activeType);
	const [dialog, setDialog] = useState<{ group: LabelGroup | null } | null>(
		null,
	);
	const [name, setName] = useState("");
	const [saving, setSaving] = useState(false);
	const [deleting, setDeleting] = useState<LabelGroup | null>(null);
	const [deleteBusy, setDeleteBusy] = useState(false);

	const openDialog = (group: LabelGroup | null) => {
		setName(group?.name ?? "");
		setDialog({ group });
	};

	const submit = async () => {
		const value = name.trim();
		if (!value || !dialog) return;
		setSaving(true);
		try {
			if (dialog.group) {
				await renameGroup(dialog.group.id, value);
			} else {
				await createGroup(activeType, value);
			}
			await invalidateLabels();
			toast.success(t("groups.saved"), { duration: 3000 });
			setDialog(null);
		} catch (error) {
			toast.error(getAPIErrorMessage(error) ?? t("groups.saveFailed"));
		} finally {
			setSaving(false);
		}
	};

	const confirmDelete = async () => {
		if (!deleting) return;
		setDeleteBusy(true);
		try {
			await deleteGroup(deleting.id);
			await invalidateLabels();
			toast.success(t("groups.deleted"), { duration: 3000 });
			setDeleting(null);
		} catch (error) {
			toast.error(getAPIErrorMessage(error) ?? t("groups.deleteFailed"));
		} finally {
			setDeleteBusy(false);
		}
	};

	const openMembers = (group: LabelGroup) => {
		if (activeType === "user") {
			useDashboard.getState().onFilterChange({
				groups: [String(group.id)],
				tags: [],
				offset: 0,
			});
			navigate("/users");
			return;
		}
		useAdminsStore.getState().onFilterChange({
			groups: [String(group.id)],
			tags: [],
			offset: 0,
		});
		navigate("/admins");
	};

	const columns = useMemo<DataTableColumn<LabelGroup>[]>(
		() => [
			{
				id: "name",
				header: t("groups.name"),
				menuLabel: t("groups.name"),
				accessor: "name",
				sortable: true,
				isPrimary: true,
				priority: "primary",
				truncate: true,
				tooltip: true,
				cellAlign: "start",
				mobilePriority: 0,
				mobileMetaLabel: t("groups.name"),
				cell: (group) => (
					<p className="truncate font-semibold text-panel-text">{group.name}</p>
				),
			},
			{
				id: "members",
				header: t("groups.members"),
				menuLabel: t("groups.members"),
				accessor: (group) => group.member_count ?? 0,
				sortable: true,
				sortType: "number",
				priority: "high",
				width: "140px",
				mobilePriority: 1,
				mobileMetaLabel: t("groups.members"),
				cell: (group) => (
					<p className="tabular-nums text-panel-text">
						{new Intl.NumberFormat(i18n.language || "en").format(
							group.member_count ?? 0,
						)}
					</p>
				),
			},
		],
		[i18n.language, t],
	);

	const rowActions = (group: LabelGroup): DataTableRowAction<LabelGroup>[] => {
		const actions: DataTableRowAction<LabelGroup>[] = [
			{
				id: "members",
				pinned: true,
				label:
					activeType === "user"
						? t("groups.openUsers")
						: t("groups.openAdmins"),
				icon:
					activeType === "user" ? (
						<Users className="w-[16px]" />
					) : (
						<Briefcase className="w-[16px]" />
					),
				onClick: () => openMembers(group),
			},
		];
		if (activeType === "user") {
			actions.push({
				id: "bulk",
				label: t("groups.bulkActions"),
				icon: <Zap className="w-[16px]" />,
				onClick: () => navigate(`/bulk-actions?group=${group.id}#edit`),
			});
		}
		if (canManage) {
			actions.push(
				{
					id: "rename",
					label: t("groups.rename"),
					icon: <Pencil className="w-[16px]" />,
					onClick: () => openDialog(group),
				},
				{
					id: "delete",
					label: t("delete"),
					icon: <Trash2 className="w-[16px]" />,
					onClick: () => setDeleting(group),
					isDanger: true,
				},
			);
		}
		return actions;
	};

	const tabs = [
		{
			value: "users",
			label: t("groups.userGroups"),
			isActive: activeType === "user",
			onClick: () => navigate({ hash: "users" }),
		},
		...(canViewAdminGroups
			? [
					{
						value: "admins",
						label: t("groups.adminGroups"),
						isActive: activeType === "admin",
						onClick: () => navigate({ hash: "admins" }),
					},
				]
			: []),
	];

	return (
		<div
			dir={i18n.dir(i18n.language)}
			className="flex w-full flex-col items-stretch gap-4"
		>
			<PageHeader
				title={t("groups.title")}
				description={t("groups.description")}
				actions={
					canManage ? (
						<Button size="sm" onClick={() => openDialog(null)}>
							<Plus />
							{t("groups.add")}
						</Button>
					) : null
				}
			/>
			{tabs.length > 1 ? <TabSystem tabs={tabs} /> : null}
			<DataTable
				ariaLabel={t("groups.title")}
				data={groups}
				columns={columns}
				getRowId={(group) => String(group.id)}
				loading={isLoading}
				loadingRows={4}
				emptyState={
					<div className="text-center">
						<p className="font-semibold">{t("groups.empty")}</p>
						<p className="mt-1 text-[0.875rem] text-panel-text-muted">
							{canManage ? t("groups.emptyHint") : t("groups.emptyReadOnly")}
						</p>
					</div>
				}
				rowActions={rowActions}
				actionsPlacement="end"
				actionsColumnWidth="60px"
				showSortMenu={false}
				onRowClick={openMembers}
				mobileBreakpoint="md"
			/>
			<AppDialog
				open={dialog !== null}
				onClose={() => setDialog(null)}
				size="sm"
				title={dialog?.group ? t("groups.rename") : t("groups.add")}
				footer={
					<>
						<Button variant="outline" size="sm" onClick={() => setDialog(null)}>
							{t("cancel")}
						</Button>
						<Button
							size="sm"
							onClick={submit}
							disabled={saving || !name.trim()}
						>
							{saving ? <Spinner /> : null}
							{t("save")}
						</Button>
					</>
				}
			>
				<FormField label={t("groups.name")}>
					<Input
						value={name}
						maxLength={64}
						autoFocus
						onChange={(event) => setName(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void submit();
						}}
					/>
				</FormField>
			</AppDialog>
			<ConfirmDialog
				open={deleting !== null}
				onClose={() => setDeleting(null)}
				onConfirm={confirmDelete}
				title={t("groups.deleteTitle")}
				description={t("groups.deleteConfirm", { name: deleting?.name ?? "" })}
				confirmLabel={t("delete")}
				colorScheme="red"
				loading={deleteBusy}
			/>
		</div>
	);
};

export default GroupsPage;
