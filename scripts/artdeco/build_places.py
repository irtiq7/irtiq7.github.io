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
]


def build_posters():
    qids = sorted({p["q"] for p in POSTERS})
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
