from app.services.access_insights import _distribute_line_budget


def test_distribute_line_budget_does_not_exceed_total_when_many_sources():
    budgets = _distribute_line_budget(total_lines=500, source_count=20, preferred_min_per_source=50)
    assert len(budgets) == 20
    assert sum(budgets) == 500
    assert all(value >= 0 for value in budgets)


def test_distribute_line_budget_honors_minimum_when_budget_allows():
    budgets = _distribute_line_budget(total_lines=1200, source_count=10, preferred_min_per_source=100)
    assert len(budgets) == 10
    assert sum(budgets) == 1200
    assert min(budgets) >= 100


def test_distribute_line_budget_handles_less_budget_than_sources():
    budgets = _distribute_line_budget(total_lines=3, source_count=5, preferred_min_per_source=50)
    assert len(budgets) == 5
    assert sum(budgets) == 3
    assert budgets.count(1) == 3
    assert budgets.count(0) == 2
