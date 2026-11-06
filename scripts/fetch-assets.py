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
    "bolt_action_rifle_7_62": "2k",
    "service_pistol": "2k",
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
}

# texture id -> resolutions (1k used on Low/Medium, 2k on High/Ultra)
TEXTURES = [
    "coast_sand_rocks_02",
    "asphalt_02",
    "sandstone_brick_wall_01",
    "concrete_wall_008",
    "corrugated_iron",
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
