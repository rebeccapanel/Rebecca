import {
	AdminRole,
	AdminTrafficLimitMode,
	type Admin,
} from "types/Admin";
import type { UserApi } from "types/User";

type AdminTrafficLike = Pick<
	Admin,
	| "role"
	| "data_limit"
	| "created_traffic"
	| "traffic_limit_mode"
	| "show_user_traffic"
> &
	Partial<UserApi>;

export const usesCreatedTrafficLimit = (
	admin?: AdminTrafficLike | null,
): boolean =>
	Boolean(
		admin &&
			admin.role !== AdminRole.FullAccess &&
			admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic,
	);

export const canViewUserTraffic = (
	admin?: AdminTrafficLike | null,
): boolean => {
	if (!admin) return true;
	if (admin.role === AdminRole.FullAccess) return true;
	if (!usesCreatedTrafficLimit(admin)) return true;
	return admin.show_user_traffic !== false;
};

export const isUserManagementLocked = (
	admin?: AdminTrafficLike | null,
): boolean => {
	if (!admin) return false;
	if (admin.role === AdminRole.FullAccess) return false;
	if (!usesCreatedTrafficLimit(admin)) return false;
	const limit = admin.data_limit ?? null;
	if (limit === null || limit === undefined || limit <= 0) return false;
	return (admin.created_traffic ?? 0) >= limit;
};
