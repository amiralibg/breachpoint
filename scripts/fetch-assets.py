#!/usr/bin/env python3
"""Download the free (CC0) assets the game uses into public/assets.

Sources:
  - Poly Haven (https://polyhaven.com) - CC0 models, PBR textures, HDRIs
  - three.js examples (Soldier.glb) - character used for enemies

Run:  python3 scripts/fetch-assets.py
Re-running skips files that already exist.
"""
import json
import os
import sys
import urllib.request

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "assets")
API = "https://api.polyhaven.com/files/"
UA = {"User-Agent": "breachpoint-asset-fetcher"}

# model id -> resolution
MODELS = {
    "wooden_crate_01": "1k",
    "wooden_crate_02": "1k",
    "old_military_crate": "1k",
    "wooden_military_crate": "1k",
    "Barrel_01": "1k",
    "barrel_03": "1k",
    "concrete_road_barrier": "1k",
    "concrete_road_barrier_02": "1k",
    "utility_box_01": "1k",
    "plastic_crate_01": "1k",
    "ammo_box": "1k",
    "covered_car": "1k",
    # Set dressing for the story maps
    "metal_trash_can": "1k",
    "trashbag": "1k",
    "old_tyre": "1k",
    "exterior_aircon_unit": "1k",
    "utility_box_02": "1k",
    "security_light": "1k",
    "cardboard_box_01": "1k",
    "plastic_crate_03": "1k",
    "metal_jerrycan": "1k",
    "propane_tank": "1k",
    "portable_generator": "1k",
    "hand_truck": "1k",
    "steel_frame_shelves_01": "1k",
    "metal_office_desk": "1k",
    "metal_stool_01": "1k",
    "korean_fire_extinguisher_01": "1k",
    "WetFloorSign_01": "1k",
    "cement_bag": "1k",
    "lifebuoy": "1k",
    "plastic_monobloc_chair_01": "1k",
    "worn_metal_rack": "1k",
    "tool_cart": "1k",
    "portable_searchlight": "1k",
    "Television_01": "1k",
    "classic_laptop": "1k",
    "mounted_fluorescent_lights": "1k",
    "industrial_wall_lamp": "1k",
    "water_manhole_cover": "1k",
    "rusted_wheel_rim_01": "1k",
    "Barrel_02": "1k",
    "metal_toolbox": "1k",
    "small_lpg_tank": "1k",
    "painted_wooden_shelves": "1k",
    "wooden_ladder": "1k",
    "hanging_industrial_lamp": "1k",
    "rollershutter_door": "1k",
    "rollershutter_window_01": "1k",
    "medical_box": "1k",
    "clipboard": "1k",
    "office_notepads": "1k",
    "binder_notebook": "1k",
    # Second dressing pass: streets, harbour, offices, workshops, the coast
    "fire_hydrant": "1k",
    "street_lamp_01": "1k",
    "street_lamp_02": "1k",
    "modular_street_seating": "1k",
    "security_camera_01": "1k",
    "security_camera_02": "1k",
    "power_box_01": "1k",
    "fire_alarm": "1k",
    "industrial_wall_sconce": "1k",
    "caged_hanging_light": "1k",
    "ocean_buoy": "1k",
    "life_jacket": "1k",
    "wooden_picnic_table": "1k",
    "painted_wooden_bench": "1k",
    "potted_plant_01": "1k",
    "potted_plant_04": "1k",
    "planter_box_01": "1k",
    "Sofa_01": "1k",
    "ArmChair_01": "1k",
    "modern_arm_chair_01": "1k",
    "CoffeeTable_01": "1k",
    "drawer_cabinet": "1k",
    "wooden_bookshelf_worn": "1k",
    "steel_frame_shelves_02": "1k",
    "steel_frame_shelves_03": "1k",
    "metal_tool_chest": "1k",
    "portable_welding_cart": "1k",
    "industrial_storage_cart": "1k",
    "can_rusted": "1k",
    "plastic_jerrycan": "1k",
    "metal_jerrycan_green": "1k",
    "plastic_crate_02": "1k",
    "CashRegister_01": "1k",
    "wooden_display_shelves_01": "1k",
    "bar_chair_round_01": "1k",
    "wall_clock": "1k",
    "standing_chalkboard_01": "1k",
    "plastic_broom": "1k",
    "ladder_sectioned_01": "1k",
    "ceiling_fan": "1k",
    "desk_lamp_arm_01": "1k",
    "SchoolChair_01": "1k",
    "boulder_01": "1k",
    "rock_07": "1k",
    "shrub_02": "1k",
    "shrub_04": "1k",
    "fern_02": "1k",
    "tree_stump_01": "1k",
    "overhead_crane": "1k",
    "television_02": "1k",
    "vintage_radio_transceiver": "1k",
    "retro_multimeter": "1k",
    "long_life_food": "1k",
    "industrial_pastic_container": "1k",
    "plastic_container": "1k",
    "wooden_table_02": "1k",
    "metal_stool_02": "1k",
    "bench_vice_01": "1k",
    "wooden_stool_01": "1k",
    "side_table_01": "1k",
    "projector_screen": "1k",
    "old_gas_mask": "1k",
    "rubber_boots": "1k",
    "multi_cleaner_5_litre": "1k",
    "dining_chair_02": "1k",
    "wicker_basket_01": "1k",
}

# texture id -> resolutions (1k used on Low/Medium, 2k on High/Ultra)
TEXTURES = [
    "coast_sand_rocks_02",
    "asphalt_02",
    "sandstone_brick_wall_01",
    "concrete_wall_008",
    "corrugated_iron",
    # Story maps
    "concrete_floor_02",
    "painted_concrete",
    "metal_plate",
    "rusty_metal_02",
    "brick_wall_001",
    "plastered_wall_04",
    "floor_tiles_06",
    "rock_wall_08",
    "medieval_blocks_02",
    "marble_01",
    "blue_metal_plate",
    "green_metal_rust",
]
TEXTURE_MAPS = {"Diffuse": "diff", "nor_gl": "nor", "arm": "arm"}

HDRIS = {"kloofendal_48d_partly_cloudy_puresky": ["1k", "2k"]}

EXTRA = {
    "characters/soldier.glb": "https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/models/gltf/Soldier.glb",
}


def get_json(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r:
        return json.load(r)


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    print("  ->", os.path.relpath(dest, ROOT))
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA)) as r, open(dest + ".part", "wb") as f:
        while True:
            chunk = r.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    os.replace(dest + ".part", dest)


def main():
    for mid, res in MODELS.items():
        print("model", mid)
        files = get_json(API + mid)
        g = files["gltf"][res]["gltf"]
        base = os.path.join(ROOT, "models", mid)
        download(g["url"], os.path.join(base, f"{mid}.gltf"))
        for rel, info in g.get("include", {}).items():
            download(info["url"], os.path.join(base, rel))

    for tid in TEXTURES:
        print("texture", tid)
        files = get_json(API + tid)
        for res in ("1k", "2k"):
            for key, short in TEXTURE_MAPS.items():
                url = files[key][res]["jpg"]["url"]
                download(url, os.path.join(ROOT, "textures", tid, f"{short}_{res}.jpg"))

    for hid, resolutions in HDRIS.items():
        print("hdri", hid)
        files = get_json(API + hid)
        for res in resolutions:
            download(files["hdri"][res]["hdr"]["url"], os.path.join(ROOT, "hdri", f"{hid}_{res}.hdr"))

    for rel, url in EXTRA.items():
        print("extra", rel)
        download(url, os.path.join(ROOT, rel))

    print("done")


if __name__ == "__main__":
    sys.exit(main())
