from loadtest.data import Point, lon_lat_to_tile


def test_singapore_tile_conversion() -> None:
    assert lon_lat_to_tile(Point(1.3521, 103.8198), 12) == (3229, 2032)
