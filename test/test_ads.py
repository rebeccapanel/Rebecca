def test_get_ads(client, auth_headers):
    response = client.get("/api/ads", headers=auth_headers)
    assert response.status_code == 200
    data = response.json()
    # Ads response should have some structure
    assert isinstance(data, dict)

