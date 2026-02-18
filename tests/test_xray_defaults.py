from app.utils.xray_defaults import (
    LOG_CLEANUP_INTERVAL_DISABLED,
    apply_log_paths,
    normalize_log_cleanup_interval,
    normalize_tls_verify_peer_cert_fields,
)


def test_normalize_log_cleanup_interval_accepts_supported_values():
    assert normalize_log_cleanup_interval("3600") == 3600
    assert normalize_log_cleanup_interval(10800) == 10800
    assert normalize_log_cleanup_interval(" 21600 ") == 21600


def test_normalize_log_cleanup_interval_rejects_unsupported_values():
    assert normalize_log_cleanup_interval(None) == LOG_CLEANUP_INTERVAL_DISABLED
    assert normalize_log_cleanup_interval("") == LOG_CLEANUP_INTERVAL_DISABLED
    assert normalize_log_cleanup_interval("invalid") == LOG_CLEANUP_INTERVAL_DISABLED
    assert normalize_log_cleanup_interval(7200) == LOG_CLEANUP_INTERVAL_DISABLED


def test_apply_log_paths_sets_cleanup_defaults():
    config = apply_log_paths({})
    assert config["log"]["accessCleanupInterval"] == LOG_CLEANUP_INTERVAL_DISABLED
    assert config["log"]["errorCleanupInterval"] == LOG_CLEANUP_INTERVAL_DISABLED


def test_apply_log_paths_normalizes_cleanup_values():
    config = apply_log_paths(
        {
            "log": {
                "accessCleanupInterval": "3600",
                "errorCleanupInterval": "bad-value",
            }
        }
    )
    assert config["log"]["accessCleanupInterval"] == 3600
    assert config["log"]["errorCleanupInterval"] == LOG_CLEANUP_INTERVAL_DISABLED


def test_normalize_tls_verify_peer_cert_fields_migrates_old_key_to_new():
    tls_settings = {
        "serverName": "example.com",
        "verifyPeerCertInNames": ["dns.google", "cloudflare-dns.com"],
    }

    normalized = normalize_tls_verify_peer_cert_fields(tls_settings)

    assert normalized["verifyPeerCertByName"] == "dns.google"
    assert "verifyPeerCertInNames" not in normalized


def test_normalize_tls_verify_peer_cert_fields_keeps_new_key_and_removes_old():
    tls_settings = {
        "verifyPeerCertByName": "one.one.one.one",
        "verifyPeerCertInNames": ["dns.google"],
    }

    normalized = normalize_tls_verify_peer_cert_fields(tls_settings)

    assert normalized["verifyPeerCertByName"] == "one.one.one.one"
    assert "verifyPeerCertInNames" not in normalized


def test_normalize_tls_verify_peer_cert_fields_legacy_mode_uses_old_key():
    tls_settings = {
        "verifyPeerCertByName": "one.one.one.one",
    }

    normalized = normalize_tls_verify_peer_cert_fields(
        tls_settings,
        use_verify_peer_cert_by_name=False,
    )

    assert normalized["verifyPeerCertInNames"] == ["one.one.one.one"]
    assert "verifyPeerCertByName" not in normalized


def test_normalize_tls_verify_peer_cert_fields_legacy_mode_keeps_old_names_list():
    tls_settings = {
        "verifyPeerCertByName": "ignored.when.old.exists",
        "verifyPeerCertInNames": ["dns.google", "cloudflare-dns.com"],
    }

    normalized = normalize_tls_verify_peer_cert_fields(
        tls_settings,
        use_verify_peer_cert_by_name=False,
    )

    assert normalized["verifyPeerCertInNames"] == ["dns.google", "cloudflare-dns.com"]
    assert "verifyPeerCertByName" not in normalized
