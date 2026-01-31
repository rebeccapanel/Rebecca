from app.utils.xray_logs import normalize_log_chunk, sort_log_lines


def test_normalize_log_chunk_splits_and_strips():
    chunk = "\n  first line  \n\nsecond line\n   \n"
    assert normalize_log_chunk(chunk) == ["first line", "second line"]


def test_sort_log_lines_orders_by_timestamp():
    lines = [
        "2026/01/27 18:38:07.652151 [Info] second",
        "2026/01/27 18:38:07.652120 [Info] first",
    ]
    assert sort_log_lines(lines) == [
        "2026/01/27 18:38:07.652120 [Info] first",
        "2026/01/27 18:38:07.652151 [Info] second",
    ]


def test_sort_log_lines_keeps_banner_near_previous_timestamp():
    lines = [
        "2026/01/27 18:38:07.000001 [Info] start",
        "Xray 25.10.15 (Xray, Penetrates Everything.)",
        "2026/01/27 18:38:08.000001 [Info] end",
    ]
    assert sort_log_lines(lines) == lines


def test_sort_log_lines_keeps_pre_timestamp_banner_first():
    lines = [
        "Xray 25.10.15 (Xray, Penetrates Everything.)",
        "2026/01/27 18:38:07.000001 [Info] start",
    ]
    assert sort_log_lines(lines) == lines
