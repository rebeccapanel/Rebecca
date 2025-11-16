import { fetch } from "service/http";
import { UserApi, UseGetUserReturn } from "types/User";
import { useQuery } from "react-query";
import {
  DEFAULT_ADMIN_PERMISSIONS,
  getDefaultPermissionsForRole,
  mergePermissionsWithRoleDefaults,
} from "constants/adminPermissions";
import { AdminRole, AdminStatus } from "types/Admin";

const fetchUser = async () => {
    return await fetch("/admin");
}

const useGetUser = (): UseGetUserReturn => {
    const { data, isError, isLoading, isSuccess, error } = useQuery<UserApi, Error>({
        queryFn: () => fetchUser()
    })

    const userDataEmpty: UserApi =  {
        role: AdminRole.Standard,
        permissions: getDefaultPermissionsForRole(AdminRole.Standard),
        telegram_id: "",
        username: "",
        users_usage: 0,
        status: AdminStatus.Active,
        disabled_reason: null
      }

    const resolvedRole = data?.role || AdminRole.Standard;
    const resolvedPermissions = data?.permissions
      ? mergePermissionsWithRoleDefaults(resolvedRole, data.permissions)
      : getDefaultPermissionsForRole(resolvedRole);

    const normalizedData: UserApi = data
      ? {
          ...data,
          role: resolvedRole,
          permissions: resolvedPermissions,
        }
      : {
          ...userDataEmpty,
          role: resolvedRole,
          permissions: resolvedPermissions,
        };

    return {
        userData: normalizedData,
        getUserIsPending: isLoading,
        getUserIsSuccess: isSuccess,
        getUserIsError: isError,
        getUserError: error
    }
};

export default useGetUser;
