import importlib


JOB_MODULES = (
    "0_xray_core",
    "add_db_users",
    "record_usages",
    "remove_expired_users",
    "reset_user_data_usage",
    "review_users",
    "send_notifications",
)


for module_name in JOB_MODULES:
    importlib.import_module(f"{__name__}.{module_name}")
