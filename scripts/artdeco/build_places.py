#!/usr/bin/env python3
"""Builds artdeco/places.json for art-deco-map.html.

Input:  scripts/artdeco/curated.json (the chosen buildings, as Wikidata ids) and the POSTERS list below.
Sources: Wikidata (coordinates, type, architect, images), Wikipedia (short descriptions, CC BY-SA), Wikimedia Commons (image licence and credit).
Only images marked public domain, CC0 or Creative Commons (BY / BY-SA) are kept. Images are not copied: the page loads previews from Wikimedia and links back.

Run:  python3 scripts/artdeco/build_places.py
"""
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "..", "artdeco", "places.json")
UA = "irtiq7-art-deco-map (https://irtiq7.github.io)"
ALLOWED = re.compile(r"^(CC0|Public domain|PD[ -].*|CC BY(-SA)? \d(\.\d)?( .*)?)$", re.I)


def http(url, data=None, accept="application/json"):
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": UA, "Accept": accept})
            return json.load(urllib.request.urlopen(req, timeout=120))
        except Exception as e:  # noqa: BLE001
            if attempt == 3:
                raise
            time.sleep(3 * (attempt + 1))


def wiki(host, **p):
    p["format"] = "json"
    return http("https://%s/w/api.php?%s" % (host, urllib.parse.urlencode(p)))


def sparql(query):
    body = urllib.parse.urlencode({"query": query, "format": "json"}).encode()
    return http("https://query.wikidata.org/sparql", data=body, accept="application/sparql-results+json")["results"]["bindings"]


def clean(t):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t or ""))).strip()


def sentences(t):
    return [s for s in re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"“(])", re.sub(r"\s+", " ", t or "").strip()) if s]


def slug(s):
    s = re.sub(r"[^a-z0-9]+", "-", s.lower().encode("ascii", "ignore").decode()).strip("-")
    return s[:60] or "item"


# ---------- categories
RULES = [
    ("bridge", r"bridge|viaduct|tunnel"),
    ("bridge", r"power station|power plant|factory|warehouse|mill\b|brewery|printing works|silo|depot|dam\b"),
    ("station", r"railway station|metro station|underground station|tube station|train station|terminal|airport|railway terminus|funicular|\bstation\b"),
    ("theatre", r"theatre|theater|cinema|opera|concert|music hall|auditorium|playhouse"),
    ("hotel", r"hotel|motel|resort"),
    ("religious", r"church|cathedral|basilica|synagogue|temple|mosque|chapel|abbey|shrine"),
    ("civic", r"city hall|town hall|courthouse|capitol|embassy|government|parliament|post office|library|museum|university|school|college|hospital|observatory|memorial|stadium|arena|sports|swimming|lido|pool|bank|exchange|council|police"),
    ("shop", r"department store|shop|market|restaurant|cafe|café|casino|club|arcade"),
    ("home", r"apartment|residential|house|villa|flats|dwelling|mansion|housing"),
    ("monument", r"monument|statue|fountain|sculpture|obelisk|lighthouse|cascade"),
    ("tower", r"skyscraper|office|commercial|tower|high-rise|building"),
]


def classify(types, label, desc):
    blob = (" ".join(types) + " " + label + " " + desc).lower()
    for name, rx in RULES:
        if re.search(rx, blob):
            return name
    return "other"


# ---------- Commons image metadata
def commons_meta(files):
    out = {}
    files = list(dict.fromkeys(files))
    for i in range(0, len(files), 40):
        d = wiki("commons.wikimedia.org", action="query", titles="|".join("File:" + f.replace("_", " ") for f in files[i:i + 40]), prop="imageinfo",
                 iiprop="url|size|mime|extmetadata", redirects=1)
        redirs = {r["to"]: r["from"] for r in d["query"].get("redirects", [])}
        for p in d["query"]["pages"].values():
            ii = (p.get("imageinfo") or [None])[0]
            if not ii:
                continue
            em = ii.get("extmetadata", {})
            g = lambda k: clean((em.get(k) or {}).get("value", ""))  # noqa: E731
            title = redirs.get(p["title"], p["title"])
            out[title[5:].replace(" ", "_")] = {"license": g("LicenseShortName"), "license_url": g("LicenseUrl"), "author": g("Artist") or g("Credit"), "w": ii["width"], "h": ii["height"],
                                                "page": "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(p["title"].replace(" ", "_")), "desc": g("ImageDescription"), "credit": g("Credit")}
        time.sleep(0.4)
    return out


def image_entry(file, meta, alt):
    m = meta.get(file.replace(" ", "_"))
    if not m or not ALLOWED.match(m["license"] or ""):
        return None
    author = re.sub(r"^(Unknown author|Unattributed\.?)$", "Unknown author", m["author"][:140]) or "Unknown author"
    return {"file": file.replace("_", " "), "w": m["w"], "h": m["h"], "author": author, "license": m["license"], "license_url": m["license_url"], "page": m["page"], "alt": alt}


# ---------- buildings
def build_buildings(curated):
    qids = [b["qid"] for b in curated["buildings"]]
    cat_override = {b["qid"]: b["cat"] for b in curated["buildings"] if b.get("cat")}
    avoid = {b["qid"]: set(f.replace(" ", "_") for f in b.get("avoid", [])) for b in curated["buildings"]}
    rows = []
    for i in range(0, len(qids), 80):
        q = """
SELECT ?item ?itemLabel ?itemDescription (SAMPLE(?coord) AS ?c) (SAMPLE(?countryL) AS ?country) (SAMPLE(?placeL) AS ?place) ?article
       (GROUP_CONCAT(DISTINCT ?typeL; separator="|") AS ?types) (GROUP_CONCAT(DISTINCT ?archL; separator="|") AS ?archs) (GROUP_CONCAT(DISTINCT ?img; separator="|") AS ?imgs) WHERE {
  VALUES ?item { %s }
  ?item wdt:P625 ?coord ; wdt:P18 ?img .
  ?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?item wdt:P17 ?cn . ?cn rdfs:label ?countryL . FILTER(LANG(?countryL)="en") }
  OPTIONAL { ?item wdt:P131 ?pl . ?pl rdfs:label ?placeL . FILTER(LANG(?placeL)="en") }
  OPTIONAL { ?item wdt:P31 ?t . ?t rdfs:label ?typeL . FILTER(LANG(?typeL)="en") }
  OPTIONAL { ?item wdt:P84 ?a . ?a rdfs:label ?archL . FILTER(LANG(?archL)="en") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?item ?itemLabel ?itemDescription ?article""" % " ".join("wd:" + x for x in qids[i:i + 80])
        rows += sparql(q)
        time.sleep(1.5)
    items = []
    for r in rows:
        g = lambda k: r.get(k, {}).get("value", "")  # noqa: E731
        try:
            lon, lat = g("c")[g("c").index("(") + 1:-1].split()
        except Exception:  # noqa: BLE001
            continue
        qid = g("item").rsplit("/", 1)[1]
        items.append({"qid": qid, "title": g("itemLabel"), "desc": g("itemDescription"), "lat": float(lat), "lon": float(lon), "country": g("country"), "place": g("place"),
                      "article": g("article"), "types": [t for t in g("types").split("|") if t], "archs": [a for a in g("archs").split("|") if a],
                      "imgs": [f for f in (urllib.parse.unquote(u.rsplit("/", 1)[1]) for u in g("imgs").split("|") if u) if f.replace(" ", "_") not in avoid.get(qid, set())][:4]})
    print(len(items), "of", len(qids), "curated buildings have coordinates, a photo and a Wikipedia article", file=sys.stderr)
    # Wikipedia text: the lead, and the full article when the lead does not mention Art Deco
    by_title = {}
    for it in items:
        by_title[urllib.parse.unquote(it["article"].rsplit("/wiki/", 1)[1]).replace("_", " ")] = it
    titles = list(by_title)
    for i in range(0, len(titles), 20):
        d = wiki("en.wikipedia.org", action="query", titles="|".join(titles[i:i + 20]), prop="extracts", exintro=1, explaintext=1, exlimit=20, redirects=1)
        redirs = {r["to"]: r["from"] for r in d["query"].get("redirects", [])}
        for p in d["query"]["pages"].values():
            it = by_title.get(redirs.get(p["title"], p["title"])) or by_title.get(p["title"])
            if it is not None:
                it["lead"] = p.get("extract", "")
        time.sleep(0.3)
    for it in items:
        if not re.search(r"art d[eé]co", it.get("lead", ""), re.I):
            t = urllib.parse.unquote(it["article"].rsplit("/wiki/", 1)[1]).replace("_", " ")
            d = wiki("en.wikipedia.org", action="query", titles=t, prop="extracts", explaintext=1, redirects=1)
            full = list(d["query"]["pages"].values())[0].get("extract", "")
            it["deco_sentence"] = next((s for s in sentences(full) if re.search(r"art d[eé]co", s, re.I) and len(s) < 260), "")
            time.sleep(0.3)
    meta = commons_meta([f for it in items for f in it["imgs"]])
    out = []
    for it in items:
        image = None
        for f in it["imgs"]:
            image = image_entry(f, meta, it["title"] + (", " + it["place"] if it["place"] else ""))
            if image:
                break
        if not image:
            print("no freely licensed image:", it["title"], file=sys.stderr)
            continue
        ss = sentences(it.get("lead", ""))
        summary = ""
        for s in ss[:3]:
            if len(summary) + len(s) > 360 and summary:
                break
            summary = (summary + " " + s).strip()
        if not re.search(r"art d[eé]co", summary, re.I):
            extra = next((s for s in ss if re.search(r"art d[eé]co", s, re.I) and len(s) < 260), "") or it.get("deco_sentence", "")
            if extra:
                summary = (summary + " " + extra).strip()
        facts = []
        if it["archs"]:
            facts.append(["Architect" if len(it["archs"]) == 1 else "Architects", ", ".join(it["archs"][:3])])
        if it["types"]:
            facts.append(["Type", it["types"][0][:1].upper() + it["types"][0][1:]])
        out.append({
            "id": slug(it["title"]), "kind": "building", "cat": cat_override.get(it["qid"]) or classify(it["types"], it["title"], it["desc"]), "title": it["title"],
            "place": it["place"] if it["place"] and it["place"] != it["country"] else "", "country": it["country"], "lat": round(it["lat"], 5), "lon": round(it["lon"], 5),
            "summary": summary, "summary_src": {"name": "Wikipedia", "url": it["article"], "license": "CC BY-SA 4.0"}, "facts": facts, "image": image,
            "links": [{"label": "Wikipedia", "url": it["article"]}, {"label": "Wikidata", "url": "https://www.wikidata.org/wiki/" + it["qid"]}],
        })
    return out


# ---------- posters (subjects and places are taken from the Commons descriptions and the posters' own text)
W = "https://en.wikipedia.org/wiki/"
POSTERS = [
    # Japan, department stores and subways
    dict(id="mitsukoshi-ginza-1930", file="Mitsukoshi Department Store Ginza Branch Opens in 1930.jpg", title="Mitsukoshi department store, Ginza branch opens", date="1930", by="Hisui Sugiura", place="Ginza, Tokyo", country="Japan", q="Q746052",
         summary="Poster for the opening of the Mitsukoshi department store's Ginza branch in 1930, designed by Hisui Sugiura. It shows the new building at night with lit windows and a neon Mitsukoshi sign above a street where shoppers in 1930s dress stroll past, among them women in long coats and a young boy.",
         facts=[["Advertises", "Mitsukoshi department store, Ginza branch"], ["Year", "1930"], ["Designer", "Hisui Sugiura"]], artist="Hisui Sugiura", wiki=W + "Mitsukoshi"),
    dict(id="mitsukoshi-shinjuku-1930", file="Mitsukoshi departmentstore shinjuku branch opens.jpg", title="Mitsukoshi department store, Shinjuku branch opens", date="1930", by="Hisui Sugiura", place="Shinjuku, Tokyo", country="Japan", q="Q836198",
         summary="Poster for the opening of Mitsukoshi's Shinjuku branch in 1930, by Hisui Sugiura. The store is drawn from above at a steep angle, its grid of windows glowing orange against blue, with a flag on the roof and crowds and cars in the street below. The poster gives the opening date as 10 October.",
         facts=[["Advertises", "Mitsukoshi department store, Shinjuku branch"], ["Year", "1930"], ["Designer", "Hisui Sugiura"]], artist="Hisui Sugiura", wiki=W + "Mitsukoshi", loc="Shinjuku district; the branch's exact site is not given in the source"),
    dict(id="mimatsu-1931", file="Mimatsu department store poster.jpg", title="Mimatsu department store opens", date="1931", by="Hisui Sugiura", place="Hibiya, Tokyo", country="Japan", q="Q1134450",
         summary="Advertising poster for the opening of the Mimatsu department store in Tokyo in 1931, designed by Hisui Sugiura. A blue building with a tower and rows of orange-lit windows fills the sheet under the English slogan “Value first!”.",
         facts=[["Advertises", "Mimatsu department store (Hibiya, Tokyo)"], ["Year", "1931"], ["Designer", "Hisui Sugiura"]], artist="Hisui Sugiura", loc="Hibiya district, where the source places the store"),
    dict(id="isetan-shinjuku-1933", file="Isetan Shinjuku Opening Poster (1933).jpg", title="Isetan Shinjuku opens", date="1933", by="Unknown", place="Shinjuku, Tokyo", country="Japan", q="Q836198",
         summary="Art Deco poster for the opening of the Isetan department store in Shinjuku in 1933. Two women walk side by side, one in a Western winter coat and cloche hat and one in a kimono, with the new store building rising behind them on a red ground.",
         facts=[["Advertises", "Isetan department store, Shinjuku"], ["Year", "1933"], ["Designer", "Not recorded"]], wiki=W + "Isetan", loc="Shinjuku district"),
    dict(id="takashimaya-osaka-1930", file="Takashimaya Osaka Opening Poster (1930).jpg", title="Takashimaya Osaka opens", date="1930", by="Unknown", place="Osaka", country="Japan", q="Q108836761",
         summary="Advertising poster for the opening of the Osaka Takashimaya department store in 1930. The store is shown at night with searchlight beams crossing the sky above a crowd and cars; the poster gives the opening day as 18 December.",
         facts=[["Advertises", "Takashimaya department store, Osaka"], ["Year", "1930"], ["Designer", "Not recorded"]], wiki=W + "Takashimaya"),
    dict(id="tokyo-underground-1927", file="Tokyo Underground Railway Poster.png", title="Tokyo Underground Railway opens", date="1927", by="Hisui Sugiura", place="Asakusa, Tokyo", country="Japan", q="Q800405",
         summary="Poster for the opening of the Tokyo Underground Railway in 1927, by Hisui Sugiura. A crowd in 1920s dress waits along the platform beside a yellow train. The headline calls it “the only underground railway in the East”.",
         facts=[["Advertises", "Tokyo Underground Railway (Ueno–Asakusa)"], ["Year", "1927"], ["Designer", "Hisui Sugiura"]], artist="Hisui Sugiura", wiki=W + "Tokyo_Underground_Railway", loc="Asakusa Station, one end of the line the poster announces"),
    dict(id="tokyo-subway-1929", file="The reconstruction of the imperial capital and Tokyo subway.jpg", title="The reconstruction of the imperial capital and Tokyo subway", date="c. 1929", by="Hisui Sugiura", place="Manseibashi, Tokyo", country="Japan", q="Q124512525",
         summary="Poster for the extension and opening of the Tokyo Underground Railway to Manseibashi Station, around 1929, by Hisui Sugiura. A yellow train crowded with passengers runs beneath a tall silhouette against a yellow sun, linking the new line to the rebuilding of Tokyo.",
         facts=[["Advertises", "Extension to Manseibashi Station"], ["Year", "c. 1929"], ["Designer", "Hisui Sugiura"]], artist="Hisui Sugiura", wiki=W + "Tokyo_Underground_Railway"),
    dict(id="midosuji-1938", file="Midosuji Line extension to Tennōji (1938).jpg", title="Midosuji subway line extended to Tennōji", date="1938", by="Unknown", place="Tennōji, Osaka", country="Japan", q="Q1132328",
         summary="Poster for the extension and opening of the Osaka Municipal Subway to Tennōji Station in 1938. A yellow-fronted train and a route map ending at Tennōji are drawn among cherry blossom.",
         facts=[["Advertises", "Osaka Municipal Subway, extension to Tennōji"], ["Year", "1938"], ["Designer", "Not recorded"]]),
    # Japan, travel
    dict(id="japan-matsushima", file="1930s Japan Travel Poster - 02.jpg", title="Towards Matsushima", date="1930s", by="Japanese Government Railways (Sendai Railway Bureau)", place="Matsushima, Miyagi", country="Japan", q="Q1144855",
         summary="Travel poster from the Sendai Railway Bureau inviting visitors to Matsushima. A gnarled pine in black silhouette and a white gull frame a bay of small pine-topped islands.",
         facts=[["Issued by", "Sendai Railway Bureau, Japanese Government Railways"], ["Date", "1930s"], ["Size as listed", "21 × 30 in"]]),
    dict(id="japan-nagoya-autumn", file="1930s Japan Travel Poster - 03.jpg", title="Autumn in Nagoya", date="1930s", by="Japanese Government Railways (Nagoya Tourism Bureau)", place="Nagoya", country="Japan", q="Q648629",
         summary="Travel poster for Nagoya in autumn. Red maple leaves frame the pale keep of Nagoya Castle against a bold red background.",
         facts=[["Issued by", "Nagoya Tourism Bureau"], ["Date", "1930s"], ["Size as listed", "24.5 × 36 in"]]),
    dict(id="japan-tenryu", file="1930s Japan Travel Poster - 06.jpg", title="Tenryū River boat tour, Nakappe to Futamata", date="1930s", by="Japanese Government Railways (Nagoya Railway Agency)", place="Tenryū River, Japan", country="Japan", q="Q13667",
         summary="Travel poster advertising boat trips down the Tenryū River from Nakappe to Futamata. A boat glides under an iron bridge with a blue mountain behind, and the text boasts a “super-speed propeller boat”.",
         facts=[["Issued by", "Nagoya Railway Agency"], ["Date", "1930s"], ["Size as listed", "24.5 × 36 in"]], loc="The Tenryū River, near the stretch advertised"),
    dict(id="japan-yoro", file="1930s Japan Travel Poster - 07.jpg", title="Yōrō in the summer", date="1930s", by="Japanese Government Railways (Nagoya and Osaka Railway Agencies)", place="Yōrō Falls, Gifu", country="Japan", q="Q3695472",
         summary="Summer travel poster for Yōrō. A man in a white hat stands on rocks beside a white waterfall in a cool green gorge.",
         facts=[["Issued by", "Nagoya and Osaka Railway Agencies"], ["Date", "1930s"], ["Size as listed", "24.5 × 36 in"]]),
    dict(id="japan-kirishima", file="1930s Japan Travel Poster - 09.jpg", title="Kirishima, Kagoshima Prefecture: retreat of spirits", date="1930s", by="Japanese Government Railways", place="Kirishima, Kagoshima", country="Japan", q="Q1132024",
         summary="Travel poster for the Kirishima volcanic highlands in Kagoshima Prefecture, titled “Retreat of spirits” in the listing. A red-trunked pine stands in front of green volcanic cones, a shrine roof and a pale peak.",
         facts=[["Issued by", "Japanese Government Railways"], ["Date", "1930s"], ["Size as listed", "27 × 41 in"]]),
    dict(id="japan-nara", file="1930s Japan Travel Poster - 11.jpg", title="Nara", date="1930s", by="Japanese Government Railways (Nara Tourist Bureau)", place="Nara", country="Japan", q="Q169134",
         summary="Poster from the Nara Tourist Bureau. Cherry blossom and a five-storey pagoda reflected in still water are drawn in pink, with deer in the foreground.",
         facts=[["Issued by", "Nara Tourist Bureau"], ["Date", "1930s"], ["Size as listed", "21 × 30 in"]]),
    dict(id="japan-miho", file="1930s Japan Travel Poster - 13.jpg", title="Summer at the Miho Peninsula", date="1930s", by="Japanese Government Railways (Nagoya Railway Agency)", place="Miho Peninsula, Shizuoka", country="Japan", q="Q869275",
         summary="Summer travel poster for the Miho Peninsula. A swimmer in an orange cap and dark swimsuit rises from the surf, with a snow-capped Mount Fuji behind the water.",
         facts=[["Issued by", "Nagoya Railway Agency"], ["Date", "1930s"], ["Size as listed", "23.5 × 34.5 in"]]),
    dict(id="japan-tateyama", file="1930s Japan Travel Poster - 14.jpg", title="Mount Tate", date="1930s", by="Japanese Government Railways (Nagoya Railway Agency)", place="Mount Tate, Toyama", country="Japan", q="Q2977103",
         summary="Mountain travel poster for Mount Tate (Tateyama). A hiker with a rucksack is seen from behind in black silhouette, looking out over a pale range of peaks under a large red title.",
         facts=[["Issued by", "Nagoya Railway Agency"], ["Date", "1930s"], ["Size as listed", "24.5 × 36 in"]]),
    # Europe and the United States
    dict(id="geneva-motor-show-1926", file="CH-000957-X-10580 Courvoisier.tif", title="International Automobile Exhibition, Geneva", date="1926", by="Jules Courvoisier", place="Geneva", country="Switzerland", q="Q71",
         summary="Poster for the international car show held in Geneva from 10 to 20 June 1926. A stylised green figure kneels in profile with her scarf streaming behind her, much like a car's radiator mascot, against red and black bands.",
         facts=[["Advertises", "Geneva International Automobile Exhibition, 10–20 June 1926"], ["Year", "1926"], ["Designer", "Jules Courvoisier"]]),
    dict(id="etat-cote-d-emeraude-1930", file="CH-000957-X-71546 de Valerio.tif", title="Rapide Côte d'Émeraude – Pyrénées", date="1930", by="Roger de Valerio", place="Paris", country="France", q="Q90",
         summary="Poster for an express train of the French State Railways (Chemins de fer de l'État), printed by Devambez in Paris. A red line on a map links London and Southampton by way of Saint-Malo, Rennes, Nantes, La Rochelle and Bordeaux to Biarritz, Lourdes and the Spanish border, beside a giant railway signal.",
         facts=[["Advertises", "State Railways express, Channel coast to the Pyrenees"], ["Year", "1930"], ["Designer", "Roger de Valerio"], ["Printer", "Devambez, Paris"]], loc="Paris, where the poster was printed; it advertises a route across western France"),
    dict(id="etat-manche-ocean-1930", file="CH-000957-X-71547 de Valerio.tif", title="Rapide Manche – Océan", date="1930", by="Roger de Valerio", place="Paris", country="France", q="Q90",
         summary="Companion poster for the French State Railways' Channel-to-Atlantic express, printed by Devambez in Paris. A blue route runs from London by way of Newhaven, Dieppe, Rouen, Le Mans, Nantes and Bordeaux towards Biarritz, with the silhouette of a locomotive crewman at the right.",
         facts=[["Advertises", "State Railways express, Channel to Atlantic"], ["Year", "1930"], ["Designer", "Roger de Valerio"], ["Printer", "Devambez, Paris"]], loc="Paris, where the poster was printed; it advertises a route across western France"),
    dict(id="leroy-opticians-1930", file="CH-000957-X-73158 Marton.tif", title="Leroy, quality optical lenses", date="1930", by="Lajos Márton", place="Rue Vivienne, Paris", country="France", q="Q3450361",
         summary="Poster for Leroy, an optician with shops at 30 rue Vivienne, 131 boulevard de Sébastopol and 52 rue du Commerce in Paris. A geometric face in yellow, grey and black wears round spectacles, in a Cubist-influenced style.",
         facts=[["Advertises", "Leroy, opticians"], ["Year", "1930"], ["Artist (as recorded on Commons)", "Lajos Márton"]], loc="30 rue Vivienne, the first address printed on the poster"),
    dict(id="modiano-1929", file="Modiano. Róbert Berény. 1929.jpg", title="Modiano", date="1929", by="Róbert Berény", place="Trieste", country="Italy", q="Q546",
         summary="Colour lithograph poster by the Hungarian painter Róbert Berény, 1929, for Modiano. A stylised man in a hat is shown in profile, a hand holding a cigarette with a ribbon of smoke curling up. According to Wikipedia, Modiano was founded in Trieste in 1868 and first made cigarette papers.",
         facts=[["Advertises", "Modiano"], ["Year", "1929"], ["Artist", "Róbert Berény"]], artist="Róbert Berény", wiki=W + "Modiano_(company)", loc="Trieste, where the company was founded"),
    dict(id="rayon-des-soieries-1930", file="Rayon des Soieries. 1930.jpg", title="Rayon des Soieries", date="1930", by="Maurice Dufrêne", place="Paris", country="France", q="Q90",
         summary="Poster by Maurice Dufrêne for a one-act opéra-bouffe, “Rayon des soieries”, with a libretto by Nino and music by Manuel Rosenthal, created for its 1930 opening and printed by Chaix in Paris. A dancer in white drapery stands in silhouette against pleated, silk-like cream and black.",
         facts=[["Advertises", "Opéra-bouffe “Rayon des soieries” (music: Manuel Rosenthal)"], ["Year", "1930"], ["Artist", "Maurice Dufrêne"], ["Printer", "Chaix, Paris"]], artist="Maurice Dufrêne", loc="Paris, where it was printed; the source does not name the theatre"),
    dict(id="kino-palaeet-1918", file="Kinopalæet Plakat åbning.jpg", title="Kino-Palæet opens", date="1918", by="Børge Biilmann-Petersen", place="Frederiksberg, Copenhagen", country="Denmark", q="Q30096",
         summary="Poster for the opening of the Kino-Palæet cinema in Frederiksberg in 1918 (“Åbner torsdag d. 26 Sept.”). A woman in an orange cloche hat and white cape looks away in profile in front of the silhouettes of the audience and the domed cinema.",
         facts=[["Advertises", "Opening of Kino-Palæet, Frederiksberg"], ["Year", "1918"], ["Artist", "Børge Biilmann-Petersen"]], loc="Frederiksberg, the part of Copenhagen where the cinema opened"),
    dict(id="red-star-line-belgenland-1923", file="Belgenland Red Star Line poster.jpg", title="Red Star Line: Belgenland", date="1923", by="Henri Cassiers", place="Antwerp", country="Belgium", q="Q12892",
         summary="Red Star Line poster of its flagship Belgenland, with an Art Deco image by Henri Cassiers and text in French offering fast freight and passenger service from Antwerp to New York and Canada. The black-funnelled liner is shown at the quay while horse-drawn carts load cargo.",
         facts=[["Advertises", "Red Star Line, Antwerp – New York – Canada"], ["Year", "1923"], ["Artist", "Henri Cassiers"], ["Ship", "SS Belgenland"]], artist="Henri Cassiers", wiki=W + "SS_Belgenland_(1914)", loc="Antwerp, the line's home port"),
    dict(id="forth-bridge-1928", file="Henry George Gawthorn - 2314681a87.jpg", title="The Forth Bridge", date="1928", by="Henry George Gawthorn", place="Forth Bridge, Scotland", country="United Kingdom", q="Q275",
         summary="Lithographic railway poster of 1928 for the London and North Eastern Railway. The red steel cantilevers of the Forth Bridge spread across a blue estuary with a train crossing and a steamer passing below.",
         facts=[["Issued by", "London and North Eastern Railway"], ["Year", "1928"], ["Artist", "Henry George Gawthorn"], ["Size as listed", "40 × 50 in"]], wiki=W + "Forth_Bridge"),
    dict(id="forth-bridge-over-the-forth-1928", file="Henry George Gawthorn - 56a4f84b4e.jpg", title="Over the Forth to the North", date="1928", by="Henry George Gawthorn", place="Forth Bridge, Scotland", country="United Kingdom", q="Q275",
         summary="Second 1928 London and North Eastern Railway poster by Henry George Gawthorn with the slogan “Over the Forth to the North”, again showing the Forth Bridge in red against a blue estuary.",
         facts=[["Issued by", "London and North Eastern Railway"], ["Year", "1928"], ["Artist", "Henry George Gawthorn"], ["Size as listed", "40 × 50 in"]], wiki=W + "Forth_Bridge"),
    dict(id="wpa-wildlife-1940", file="DontKillWildlifeWPA1940.jpg", title="Don't kill our wild life", date="c. 1940", by="WPA Federal Art Project", place="Washington, D.C.", country="United States", q="Q61",
         summary="Poster from the US Works Progress Administration, around 1940, urging safe driving in national parks. Two deer leap across a forest road at night, caught in a car's headlights. It carries the name of the Department of the Interior's National Park Service.",
         facts=[["Issued by", "US Department of the Interior, National Park Service"], ["Date", "c. 1940"], ["Programme", "Works Progress Administration"]], loc="Washington, D.C., seat of the Department of the Interior; the poster itself shows no particular park"),
    # More posters from the Commons Art Deco poster category and travel-poster collections. Placement is the place advertised (or the printer's/event city).
    dict(id="japan-obama", file="1930s Japan Travel Poster - 01.jpg", title="Sea bathing at Obama", date="1930s", by="Japanese Government Railways", place="Obama, Fukui", country="Japan", ll=(35.4954, 135.7468),
         summary="Japanese railway poster of the 1930s advertising sea bathing at Obama in Fukui. A rock arch stands over a green bay with small boats and a waterfall, and a red line of railway stops runs along the bottom edge.",
         facts=[["Advertises", "Sea bathing, Obama (Fukui)"], ["Issued by", "Osaka and Nagoya Rail Agency"], ["Year", "1930s"]], wiki=W + "Obama,_Fukui"),
    dict(id="japan-yunoyama", file="1930s Japan Travel Poster - 05.jpg", title="Autumn leaves at Yunoyama Onsen", date="1930s", by="Japanese Government Railways", place="Yunoyama Onsen, Mie", country="Japan", ll=(35.0207, 136.4263),
         summary="Autumn travel poster for the hot spring resort of Yunoyama. Orange and red maple leaves fill the foreground above a stream and a small bridge, with bold flat colours and the title written in large red characters.",
         facts=[["Advertises", "Autumn leaves, Yunoyama Onsen"], ["Issued by", "Osaka and Nagoya Rail Agency"], ["Year", "1930s"]], loc="Yunoyama Onsen, Mie Prefecture, named in the poster title"),
    dict(id="japan-hakusan", file="1930s Japan Travel Poster - 08.jpg", title="Hakusan, ready to be climbed", date="1930s", by="Japanese Government Railways", place="Mount Hakusan, Ishikawa", country="Japan", ll=(36.1553, 136.7716),
         summary="A poster that works like a map: the green slopes of Mount Hakusan are drawn in layers with marked climbing routes and huts, and the title is set as a large character at the top. It was issued to encourage summer climbing by train.",
         facts=[["Advertises", "Climbing Mount Hakusan"], ["Issued by", "Nagoya Rail Agency"], ["Year", "1930s"]], wiki=W + "Mount_Haku"),
    dict(id="japan-yamanashi", file="1930s Japan Travel Poster - 10.jpg", title="Fields of colour, Yamanashi", date="1930s", by="Japanese Government Railways", place="Yamanashi Prefecture", country="Japan", ll=(35.6639, 138.5683),
         summary="Autumn poster for Yamanashi Prefecture. A snow-capped peak rises behind a green valley with a river, a dark rock face stands in the foreground, and a red railway line with its stops runs along the bottom.",
         facts=[["Advertises", "Autumn colour, Yamanashi"], ["Issued by", "Japanese Railways"], ["Year", "1930s"]]),
    dict(id="japan-kumgang", file="1930s Japan Travel Poster - 12.jpg", title="Mount Kumgang in Korea", date="1930s", by="Japanese Government Railways", place="Mount Kumgang, Korea", country="North Korea", ll=(38.6, 128.05),
         summary="Dramatic poster for Mount Kumgang, then a tourist destination in Japanese-ruled Korea. Dark jagged cliffs rise out of pale mist, with the name in large red characters below and timetable details in small print.",
         facts=[["Advertises", "Mount Kumgang (Diamond Mountains)"], ["Issued by", "Japanese Tourist Bureau"], ["Year", "1930s"]], wiki=W + "Kumgangsan"),
    dict(id="japan-ontake-shosenkyo", file="1930s Japan Travel Poster - Ontake Shosenkyo Valley.jpg", title="Ontake Shosenkyo valley", date="1930s", by="Nagoya Train Agency", place="Shosenkyo, Yamanashi", country="Japan", ll=(35.7333, 138.5817),
         summary="Poster for the Shosenkyo gorge in Yamanashi in autumn. Red leaves frame a footbridge over the valley, and a cluster of grapes at the lower right points to the prefecture's vineyards.",
         facts=[["Advertises", "Ontake Shosenkyo valley"], ["Issued by", "Nagoya Train Agency"], ["Year", "1930s"]], loc="Shosenkyo gorge, named in the poster title"),
    dict(id="japan-kyoto-leaves", file="1930s Japan Travel Poster Kyoto 1.jpg", title="To Kyoto: autumn leaves", date="1930s", by="Japanese Government Railways", place="Kyoto", country="Japan", ll=(35.0116, 135.7681),
         summary="Kyoto poster on a red ground, with a white beam sweeping down the sheet scattered with falling maple leaves and a tiny figure carrying a load across a bridge. The single large character at the top reads Kyoto.",
         facts=[["Advertises", "Travel to Kyoto"], ["Issued by", "Japanese Government Railways"], ["Year", "1930s"]], wiki=W + "Kyoto"),
    dict(id="japan-kyoto-maiko", file="1930s Japan Travel Poster Kyoto 2.jpg", title="To Kyoto: maiko among maples", date="1930s", by="Japanese Government Railways", place="Kyoto", country="Japan", ll=(35.0036, 135.7788),
         summary="Poster showing a young woman in a kimono with ornamented hair, in profile against a pale landscape of hills and a pagoda, with maple leaves around her. “To Kyoto” is written along the bottom.",
         facts=[["Advertises", "Travel to Kyoto"], ["Issued by", "Japanese Government Railways"], ["Year", "1930s"]], wiki=W + "Kyoto", loc="Kyoto"),
    dict(id="japan-nikko-ski", file="1930s Japan Travel Poster Nikko.jpg", title="Skiing in Nikko", date="1930s", by="Japanese Government Railways", place="Nikko, Tochigi", country="Japan", ll=(36.75, 139.5985),
         summary="Winter sports poster in a bold modern layout: a stylised ski and a sweeping snow slope in blue and orange, with the word for skiing in red and the place name Nikko in large yellow characters. The lower band names the Tochigi prefecture sports association.",
         facts=[["Advertises", "Skiing at Nikko"], ["Year", "1930s"]], wiki=W + "Nikkō,_Tochigi"),
    dict(id="japan-hizen-hama", file="Japan Travel Poster Hizen-Hama.jpg", title="Hizen-Hama shrine festival", date="1930s", by="Japanese Government Railways", place="Hizen-Hama, Saga", country="Japan", ll=(33.0881, 130.0981),
         summary="Railway poster for Hizen-Hama in Saga. A shrine hall with red pillars and a broad blue-black roof is set among rounded pines on a red-edged sheet, and festival dates are printed in Japanese down the left side.",
         facts=[["Advertises", "Hizen-Hama (Saga)"], ["Issued by", "Japanese Government Railways"], ["Year", "1930s"]], loc="Hizen-Hama, named in the title"),
    dict(id="monza-1933", file="1933-09-10 Monza poster.jpg", title="Gran Premio d'Italia, Monza", date="1933", by="Araca", place="Monza", country="Italy", ll=(45.6156, 9.2811),
         summary="Poster for the Italian Grand Prix at Monza on 10 September 1933, issued by the Reale Automobile Club d'Italia. A red racing car is drawn head-on in simplified geometric shapes against bold blue lettering; the date is given in the Fascist calendar as year XI.",
         facts=[["Advertises", "Gran Premio d'Italia, 10 September 1933"], ["Organiser", "Reale Automobile Club d'Italia"], ["Artist", "Araca"]], wiki=W + "1933_Italian_Grand_Prix"),
    dict(id="broders-marseille", file="Flickr - …trialsanderrors - Marseille, travel poster for PLM, ca. 1930.jpg", title="Marseille, gateway to North Africa", date="c. 1930", by="Roger Broders", place="Marseille", country="France", ll=(43.2965, 5.3698),
         summary="Travel poster for the railway company PLM by Roger Broders, headed “Marseille, porte de l'Afrique du Nord”. Ship funnels and a white liner fill the foreground, with the harbour and the hilltop basilica of Notre-Dame de la Garde behind.",
         facts=[["Issued by", "Paris–Lyon–Méditerranée railway (PLM)"], ["Year", "c. 1930"], ["Artist", "Roger Broders"]], artist="Roger Broders", wiki=W + "Marseille"),
    dict(id="broders-monte-carlo", file="Flickr - …trialsanderrors - Monte-Carlo, travel poster for PLM, ca. 1930.jpg", title="Monte-Carlo", date="c. 1930", by="Roger Broders", place="Monte Carlo", country="Monaco", ll=(43.7384, 7.4246),
         summary="PLM travel poster by Roger Broders. A couple in the foreground watch a tennis match on clay courts that curve along the bay, with spectators filling the terrace and the name in heavy black capitals.",
         facts=[["Issued by", "Paris–Lyon–Méditerranée railway (PLM)"], ["Year", "c. 1930"], ["Artist", "Roger Broders"]], artist="Roger Broders", wiki=W + "Monte_Carlo"),
    dict(id="italian-lakes-enit", file="Italian Lakes, travel poster for ENIT, ca. 1930.jpg", title="Italian Lakes", date="c. 1930", by="Printed by Grafiche Modiano for ENIT", place="Lake Como, Lombardy", country="Italy", ll=(45.9, 9.2563),
         summary="Italian State Tourist Board poster showing a lake among mountains with a church bell tower, red roofs and a tall cypress. The scene is drawn in flat colours with heavy black lettering at the bottom.",
         facts=[["Issued by", "ENIT, Italian State Tourist Board"], ["Printer", "Grafiche Modiano"], ["Year", "c. 1930"]], loc="Pin set on Lake Como as a representative lake; the poster does not name which lake"),
    dict(id="yangtze-gorges", file="Beauty and grandeur, the Yangtze gorges, travel poster, ca. 1930.jpg", title="Beauty and grandeur: the Yangtze gorges", date="c. 1930", by="Unknown artist for Butterfield & Swire", place="Yangtze Gorges", country="China", ll=(30.8231, 111.0033),
         summary="Travel poster for the Yangtze gorges issued for the shipping agents Butterfield & Swire. Tourist boats pass between steep cliffs crowned with a temple, in layered flat colours, with the invitation “all amaze and thrill you” and a black band for reservations.",
         facts=[["Issued for", "Butterfield & Swire"], ["Year", "c. 1930"], ["Subject", "Yangtze river gorges"]], wiki=W + "Three_Gorges"),
    dict(id="commonwealth-railways-1951", file="Commonwealth Railways poster -- To the east in air-conditioned comfort (Trans-Australian Railway), 1951.jpg", title="To the east in air-conditioned comfort", date="1951", by="Commonwealth Railways", place="Trans-Australian Railway, South Australia", country="Australia", ll=(32.4926, 137.7686),
         summary="Australian rail poster in streamline style: a red diesel-electric train with a rounded nose races toward the viewer over a yellow plain under the slogan “To the east in air-conditioned comfort”. It promotes the Trans-Australian Railway.",
         facts=[["Issued by", "Commonwealth Railways"], ["Year", "1951"], ["Line", "Trans-Australian Railway"]], wiki=W + "Trans-Australian_Railway", loc="Port Augusta, where the Commonwealth Railways were based; the poster names the line, not a place"),
    dict(id="nz-railways-cheap-travel", file="New Zealand Railway poster - Cheap Travel by Train 1930-1939 (10468990864).jpg", title="Cheap travel by train", date="1930s", by="New Zealand Railways", place="Wellington", country="New Zealand", ll=(-41.2866, 174.7756),
         summary="New Zealand Railways holiday poster built on a sunburst of red, yellow and blue with cut-out figures around a central disc that reads “Cheap travel by train”. Small text promotes Christmas and New Year holidays and says fares average less than a penny a mile.",
         facts=[["Issued by", "New Zealand Railways"], ["Year", "1930s"], ["Fare claim", "Under 1d per mile"]], loc="Wellington, seat of New Zealand Railways; the poster is national"),
    dict(id="intourist-moscow", file="Moscow (Travel poster).jpg", title="Moscow (Intourist)", date="c. 1930", by="Unknown artist for Intourist", place="Moscow", country="Russia", ll=(55.752, 37.6175),
         summary="Soviet tourism poster for Intourist showing a Kremlin tower in red brick with green roof, set against a blue-green sky and modern city blocks. Text at the foot says tours to the USSR were arranged by Intourist and the main travel bureaus of the world.",
         facts=[["Issued by", "Intourist, for foreign tourists"], ["Year", "c. 1930"]], wiki=W + "Intourist"),
    dict(id="intourist-odessa-istanbul", file="Odessa–Istanbul (Travel poster).jpg", title="Odessa–Istanbul, 34 hours", date="c. 1930", by="Unknown artist for the USSR Black Sea State Steamship Line", place="Odessa", country="Ukraine", ll=(46.4825, 30.7233),
         summary="Poster for the Soviet Black Sea steamship line. A large liner at the right sits beside a film strip with views of Odessa, and the ports along the route (including Istanbul, Piraeus, Jaffa and Port Said) are listed beneath. The headline promises 34 hours between Odessa and Istanbul.",
         facts=[["Issued by", "USSR Black Sea State Steamship Line"], ["Year", "c. 1930"], ["Route", "Odessa to the Near East"]], wiki=W + "Odesa"),
    dict(id="casino-de-paris-gorille", file="Poster Charles Gir 1925.png", title="Le Gorille et la femme, Casino de Paris", date="1925", by="Charles Gir", place="Casino de Paris", country="France", ll=(48.8767, 2.3367),
         summary="Offset-printed poster by Charles Gir for a Casino de Paris revue in 1925. A black gorilla carries a limp woman in his arms against a cream ground, the title in heavy red capitals above and the venue name below.",
         facts=[["Advertises", "Revue at the Casino de Paris"], ["Year", "1925"], ["Artist", "Charles Gir"]], wiki=W + "Casino_de_Paris"),
    dict(id="expo-1925-poster", file="Poster Expo 1925.JPG", title="International Exhibition of Modern Decorative and Industrial Arts, 1925", date="1925", by="See the Commons record", place="Paris", country="France", ll=(48.8584, 2.3135),
         summary="Official poster for the 1925 Paris exhibition from which Art Deco takes its name. A pale ground carries a stylised rose-like form and a column of smoke above a small boat, with the exhibition title and “April–October 1925” set below.",
         facts=[["Event", "Exposition internationale des arts décoratifs et industriels modernes"], ["Dates", "April–October 1925"]], wiki=W + "Exposition_Internationale_des_Arts_D%C3%A9coratifs_et_Industriels_Modernes", loc="Paris, host city; the exhibition ran along the Seine near the Esplanade des Invalides"),
    dict(id="expo-1925-bourdelle", file="Ministère du commerce et de l'industrie. Exposition internationale des arts décoratifs et industriels modernes affiche, Antoine Bourdelle.jpg", title="1925 Paris exhibition, poster by Antoine Bourdelle", date="1925", by="Antoine Bourdelle", place="Paris", country="France", ll=(48.8584, 2.3135),
         summary="Another poster for the 1925 exhibition, designed by the sculptor Antoine Bourdelle for the Ministry of Commerce and Industry. A winged figure with a horse is drawn in a bronze-brown relief style above the line “Par labeur et par génie” and the exhibition details.",
         facts=[["Issued by", "Ministère du commerce et de l'industrie"], ["Year", "1925"], ["Artist", "Antoine Bourdelle"]], loc="Paris, host city of the exhibition"),
    dict(id="norblin-zakopane", file="Stefan Norblin - Polska - Zakopane (poster ca. 1925).png", title="Poland: Zakopane", date="c. 1925", by="Stefan Norblin", place="Zakopane", country="Poland", ll=(49.2992, 19.9496),
         summary="Polish State Railways poster by Stefan Norblin. A highlander in a white wool cape and traditional dress leans on his stick before the snowy Tatra Mountains, with “Polska Zakopane” in heavy letters and the title in Polish, French and English.",
         facts=[["Issued by", "Polish State Railways"], ["Year", "c. 1925"], ["Artist", "Stefan Norblin"]], artist="Stefan Norblin", wiki=W + "Zakopane"),
    dict(id="norblin-krakow", file="Stefan Norblin - KRAKÓW.jpg", title="Poland: Kraków", date="c. 1935", by="Stefan Norblin", place="Kraków", country="Poland", ll=(50.0540, 19.9353),
         summary="Polish State Railways poster for Kraków by Stefan Norblin. The dark silhouette of the Wawel hill cathedral and castle stands against an orange sky, with the city name in a thin, tall typeface.",
         facts=[["Issued by", "Polish State Railways"], ["Year", "c. 1935"], ["Artist", "Stefan Norblin"]], artist="Stefan Norblin", wiki=W + "Wawel"),
    dict(id="norblin-warszawa", file="Stefan Norblin - WARSZAWA.jpg", title="Poland: Warsaw", date="c. 1925", by="Stefan Norblin", place="Warsaw", country="Poland", ll=(52.2497, 21.0122),
         summary="Poster for Warsaw by Stefan Norblin: the Old Town's tall tenements and church towers are painted in warm reds and yellows against a dark border, with a boat on the Vistula below and the city name across the bottom.",
         facts=[["Issued by", "Polish State Railways"], ["Year", "c. 1925"], ["Artist", "Stefan Norblin"]], artist="Stefan Norblin", wiki=W + "Warsaw_Old_Town"),
    dict(id="norblin-wilno", file="Stefan Norblin - WILNO.jpg", title="Poland: Wilno (Vilnius)", date="c. 1930", by="Stefan Norblin", place="Vilnius", country="Lithuania", ll=(54.6872, 25.2797),
         summary="Poster for Wilno, now Vilnius, which was part of Poland between the wars. The old town's towers and roofs are shown as a layered blue silhouette beneath a yellow sky, with the name in white capitals.",
         facts=[["Issued by", "Polish State Railways"], ["Year", "c. 1930"], ["Artist", "Stefan Norblin"]], artist="Stefan Norblin", wiki=W + "Vilnius", loc="Vilnius, which the poster calls Wilno"),
    dict(id="norblin-silesia", file="Stefan Norblin - Polska. Górny Śląsk (ok. 1925).jpg", title="Poland: Upper Silesia", date="c. 1925", by="Stefan Norblin", place="Katowice, Upper Silesia", country="Poland", ll=(50.2649, 19.0238),
         summary="Polish State Railways poster for Upper Silesia, the coal and industry region. A miner with a pickaxe over his shoulder stands against a smoky skyline of chimneys, above the region's name in Polish, French, English and German.",
         facts=[["Issued by", "Polish State Railways"], ["Year", "c. 1925"], ["Artist", "Stefan Norblin"]], artist="Stefan Norblin", wiki=W + "Upper_Silesia", loc="Katowice, the main city of Upper Silesia"),
    dict(id="vef-minox-1939", file="VEF MINOX 1939 Publicity.jpg", title="VEF Minox, “The new way”", date="1939", by="Unknown", place="Riga", country="Latvia", ll=(56.9496, 24.1052),
         summary="1939 advertisement for the Minox miniature camera made by VEF in Riga. The small silver camera floats in a dark, rain-streaked night, with the brand name above and the Latvian slogan “Jaunais ceļš” (The new way) in red script.",
         facts=[["Advertises", "VEF Minox camera"], ["Year", "1939"], ["Maker", "VEF, Riga"]], wiki=W + "Minox"),
]


def build_posters():
    qids = sorted({p["q"] for p in POSTERS if p.get("q")})
    d = http("https://www.wikidata.org/w/api.php?" + urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(qids), "props": "claims", "format": "json"}))
    coords = {}
    for q, ent in d["entities"].items():
        c = ent.get("claims", {}).get("P625")
        if c:
            v = c[0]["mainsnak"]["datavalue"]["value"]
            coords[q] = (round(v["latitude"], 5), round(v["longitude"], 5))
    meta = commons_meta([p["file"] for p in POSTERS])
    notes = {}
    for a in sorted({p["artist"] for p in POSTERS if p.get("artist")}):
        r = wiki("en.wikipedia.org", action="query", titles=a, prop="extracts", exintro=1, explaintext=1, redirects=1)
        pg = list(r["query"]["pages"].values())[0]
        first = (sentences(pg.get("extract", "")) or [""])[0]
        notes[a] = {"text": first, "name": "Wikipedia", "url": W + urllib.parse.quote(pg["title"].replace(" ", "_")), "license": "CC BY-SA 4.0"} if first else None
        time.sleep(0.3)
    out = []
    for p in POSTERS:
        img = image_entry(p["file"], meta, p["title"] + " (poster)")
        if not img:
            print("poster skipped (licence not allowed or file missing):", p["title"], file=sys.stderr)
            continue
        if p.get("ll"):
            coords[p["id"]] = p["ll"]
            p["q"] = p["id"]
        if p["q"] not in coords:
            print("no coordinates for", p["q"], p["title"], file=sys.stderr)
            continue
        m = meta[p["file"].replace(" ", "_")]
        links = [{"label": "Poster on Wikimedia Commons", "url": img["page"]}]
        src = re.search(r"https?://\S+", m.get("credit", "") or "")
        if src and src.group(0).startswith("https://"):
            links.append({"label": "Source of the image", "url": src.group(0).rstrip(".,)")})
        if p.get("wiki"):
            links.append({"label": "Wikipedia: " + urllib.parse.unquote(p["wiki"].rsplit("/", 1)[1]).replace("_", " "), "url": p["wiki"]})
        e = {"id": p["id"], "kind": "poster", "cat": "poster", "title": p["title"], "place": p["place"], "country": p["country"], "lat": coords[p["q"]][0], "lon": coords[p["q"]][1],
             "date": p["date"], "by": p["by"], "summary": p["summary"], "facts": p["facts"], "image": img, "links": links}
        if p.get("loc"):
            e["loc_note"] = p["loc"]
        if p.get("artist") and notes.get(p["artist"]):
            e["artist_note"] = notes[p["artist"]]
        out.append(e)
    return out


def main():
    curated = json.load(open(os.path.join(HERE, "curated.json")))
    buildings = build_buildings(curated)
    posters = build_posters()
    seen = set()
    for it in buildings + posters:
        base = it["id"]
        n = 2
        while it["id"] in seen:
            it["id"] = "%s-%d" % (base, n)
            n += 1
        seen.add(it["id"])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(buildings + posters, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("wrote %d buildings and %d posters to artdeco/places.json" % (len(buildings), len(posters)), file=sys.stderr)


if __name__ == "__main__":
    main()
