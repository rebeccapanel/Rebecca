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
	| "deleted_users_usage"
	| "traffic_limit_mode"
	| "use_service_traffic_limits"
	| "show_user_traffic"
	| "delete_user_usage_limit_enabled"
	| "delete_user_usage_limit"
	| "service_limits"
> &
	Partial<UserApi>;

export const usesCreatedTrafficLimit = (
	admin?: AdminTrafficLike | null,
): boolean =>
	Boolean(
		admin &&
			admin.role !== AdminRole.FullAccess &&
			!admin.use_service_traffic_limits &&
			admin.traffic_limit_mode === AdminTrafficLimitMode.CreatedTraffic,
	);

const getServiceLimit = (
	admin: AdminTrafficLike | null | undefined,
	serviceId?: number | null,
) =>
	(admin?.service_limits ?? []).find((item) => item.service_id === serviceId) ??
	null;

export const getAdminTrafficScope = (
	admin: AdminTrafficLike | null | undefined,
	serviceId?: number | null,
) => {
	if (!admin) return null;
	if (admin.use_service_traffic_limits) {
		return getServiceLimit(admin, serviceId);
	}
	return admin;
};

export const canViewUserTraffic = (
	admin?: AdminTrafficLike | null,
	serviceId?: number | null,
): boolean => {
	if (!admin) return true;
	if (admin.role === AdminRole.FullAccess) return true;
	if (admin.use_service_traffic_limits) {
		const serviceLimit = getServiceLimit(admin, serviceId);
		if (!serviceLimit) return true;
		if (
			serviceLimit.traffic_limit_mode !== AdminTrafficLimitMode.CreatedTraffic
		) {
			return true;
		}
		return serviceLimit.show_user_traffic !== false;
	}
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

export const canDeleteUserByTrafficCap = (
	admin: AdminTrafficLike | null | undefined,
	user?: { used_traffic?: number | null; service_id?: number | null } | null,
): boolean => {
	if (!admin || admin.role === AdminRole.FullAccess || !user) return true;
	const serviceLimit = admin.use_service_traffic_limits
		? getServiceLimit(admin, user.service_id)
		: null;
	const scope = serviceLimit ?? admin;
	if (scope.traffic_limit_mode !== AdminTrafficLimitMode.CreatedTraffic) {
		return true;
	}
	if (!scope.delete_user_usage_limit_enabled) {
		if (serviceLimit) {
			const limit = serviceLimit.data_limit ?? null;
			if (limit && limit > 0) {
				return (serviceLimit.created_traffic ?? 0) < limit;
			}
		}
		return !isUserManagementLocked(admin);
	}
	const limit = scope.delete_user_usage_limit ?? 0;
	return (user.used_traffic ?? 0) <= limit;
};
