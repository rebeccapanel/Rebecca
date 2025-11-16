import { getAuthToken } from "utils/authStorage";
import { fetch } from "service/http";
import { UserApi, UseGetUserReturn } from "types/User";
import { useQuery } from "react-query";
import { DEFAULT_ADMIN_PERMISSIONS } from "constants/adminPermissions";
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
        permissions: DEFAULT_ADMIN_PERMISSIONS,
        telegram_id: "",
        username: "",
        users_usage: 0,
        status: AdminStatus.Active,
        disabled_reason: null
      }

    const normalizedData: UserApi = data
      ? {
          ...data,
          role: data.role || AdminRole.Standard,
          permissions: data.permissions || DEFAULT_ADMIN_PERMISSIONS,
        }
      : userDataEmpty;

    return {
        userData: normalizedData,
        getUserIsPending: isLoading,
        getUserIsSuccess: isSuccess,
        getUserIsError: isError,
        getUserError: error
    }
};

export default useGetUser;
