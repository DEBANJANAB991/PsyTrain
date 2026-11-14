"""Build PsyTrain_pitch_cutouts.pptx from design-b-cutouts.html.

Each slide becomes:
  - a background image of the artwork (paper, cut-outs, screenshots) rendered by Chrome with the text hidden,
  - editable text boxes on top, at the positions, fonts, sizes and colours the browser laid out,
  - on the two demo slides, the real .mp4 embedded with rounded corners and set to play automatically,
  - the speaker notes from data-notes.

Requires Google Chrome plus:  pip install playwright python-pptx
Run:  python build_pptx.py
"""
import re
from pathlib import Path

from lxml import etree
from playwright.sync_api import sync_playwright
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

HERE = Path(__file__).resolve().parent
DECK = HERE / "design-b-cutouts.html"
OUT = HERE / "PsyTrain_pitch_cutouts.pptx"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP = HERE / ".pptx-build"

W_PX, H_PX = 1920, 1080
SLIDE_W, SLIDE_H = Emu(12192000), Emu(6858000)  # 13.333 x 7.5 in (16:9)
EMU_PER_PX = 12192000 / W_PX
PT_PER_PX = 0.5  # 13.333 in * 72 pt / 1920 px

# Elements that become editable text. Text inside a nested match belongs to the nested one.
TEXT_SELECTOR = "h1, h2, .kicker, .sub, .pill, .team, .line, .lead, .next, .tag, .word b, .word span, .logo, .built"

EXTRACT_JS = r"""
(sel) => {
  const slide = document.querySelector('.slide.on');
  const els = [...slide.querySelectorAll(sel)];
  const owned = new Set(els);
  const out = [];
  for (const el of els) {
    const words = [];
    const walk = (node) => {
      for (const c of node.childNodes) {
        if (c.nodeType === 3) {
          const re = /\S+\s*/g; let m;
          while ((m = re.exec(c.textContent))) {
            const r = document.createRange(); r.setStart(c, m.index); r.setEnd(c, m.index + m[0].trimEnd().length);
            const b = r.getBoundingClientRect(); if (!b.width) continue;
            const cs = getComputedStyle(c.parentElement);
            words.push({ t: m[0].replace(/\s+/g, ' '), b: [b.left, b.top, b.right, b.bottom],
              size: parseFloat(cs.fontSize), family: cs.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
              color: cs.color, bold: parseInt(cs.fontWeight) >= 600, italic: cs.fontStyle === 'italic' });
          }
        } else if (c.nodeType === 1 && !owned.has(c) && c.tagName.toLowerCase() !== 'svg') walk(c);
      }
    };
    walk(el);
    if (!words.length) continue;
    const cs = getComputedStyle(el);
    const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const centered = cs.textAlign === 'center' || el.matches('.pill, .logo, .word b, .word span');
    out.push({ words, lh, centered });
  }
  const videos = [...slide.querySelectorAll('video')].map(v => {
    const f = v.parentElement, b = f.getBoundingClientRect(), cs = getComputedStyle(f);
    const m = cs.transform.match(/matrix\(([^,]+),\s*([^,]+)/);
    return { src: v.getAttribute('src'), poster: v.getAttribute('poster'), start: parseFloat(slide.dataset.start || 0),
             w: f.offsetWidth, h: f.offsetHeight, cx: b.left + b.width / 2, cy: b.top + b.height / 2,
             rot: m ? Math.atan2(parseFloat(m[2]), parseFloat(m[1])) * 180 / Math.PI : 0,
             radius: parseFloat(cs.borderTopLeftRadius) || 0 };
  });
  return { texts: out, videos, notes: slide.dataset.notes || '' };
}
"""

FREEZE_CSS = """
*, *::before, *::after { animation: none !important; transition: none !important; }
.rise { opacity: 1 !important; transform: none !important; filter: none !important; }
#progress, #hud, #notes { display: none !important; }
"""
HIDE_TEXT_CSS = """
.slide *:not(svg):not(svg *):not(.cap) { color: transparent !important; -webkit-text-fill-color: transparent !important; }
.logo svg { fill: #3b2340 !important; }
video { visibility: hidden !important; }
"""


def rgb(css):
    m = re.match(r"rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)", css)
    return RGBColor(*(int(float(x)) for x in m.groups())) if m else RGBColor(0x3B, 0x23, 0x40)


def px(v):
    return Emu(int(round(v * EMU_PER_PX)))


def add_text(slide, block):
    words = block["words"]
    # split into lines where the browser wrapped
    lines, cur, top = [], [], None
    for w in words:
        if top is not None and w["b"][1] > top + w["size"] * 0.5:
            lines.append(cur); cur = []
        if not cur:
            top = w["b"][1]
        cur.append(w)
    lines.append(cur)
    left = min(w["b"][0] for w in words); right = max(w["b"][2] for w in words)
    first_h = max(w["b"][3] - w["b"][1] for w in lines[0])
    lh = block["lh"]
    y = lines[0][0]["b"][1] - (lh - first_h) / 2
    pad = 0.08 * (right - left) + 24
    x0, x1 = (left - pad, right + pad) if block["centered"] else (left, right + pad)
    box = slide.shapes.add_textbox(px(x0), px(y), px(x1 - x0), px(lh * len(lines)))
    tf = box.text_frame
    tf.word_wrap = False
    tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
    tf.vertical_anchor = MSO_ANCHOR.TOP
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER if block["centered"] else PP_ALIGN.LEFT
    p.line_spacing = Pt(lh * PT_PER_PX)
    for i, line in enumerate(lines):
        if i:
            p.add_line_break()
        # merge consecutive words with the same style into one run
        runs = []
        for w in line:
            key = (w["family"], w["size"], w["color"], w["bold"], w["italic"])
            if runs and runs[-1][0] == key:
                runs[-1][1] += w["t"]
            else:
                runs.append([key, w["t"]])
        runs[-1][1] = runs[-1][1].rstrip()
        for (family, size, color, bold, italic), text in runs:
            r = p.add_run(); r.text = text
            f = r.font; f.name = family; f.size = Pt(size * PT_PER_PX); f.bold = bold; f.italic = italic
            f.color.rgb = rgb(color)


def autoplay(slide, clips):
    """Start every clip together when the slide appears. clips: [(pic, start_s, dur_ms)]."""
    calls, nodes, nid = [], [], 5
    for k, (pic, start_s, dur_ms) in enumerate(clips):
        kind = "afterEffect" if k == 0 else "withEffect"
        calls.append(f"""<p:par><p:cTn id="{nid}" presetID="1" presetClass="mediacall" presetSubtype="0" fill="hold" nodeType="{kind}"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
<p:cmd type="call" cmd="playFrom({start_s:.1f})"><p:cBhvr><p:cTn id="{nid + 1}" dur="{dur_ms}" fill="hold"/><p:tgtEl><p:spTgt spid="{pic.shape_id}"/></p:tgtEl></p:cBhvr></p:cmd>
</p:childTnLst></p:cTn></p:par>""")
        nid += 2
    for pic, _, _ in clips:
        nodes.append(f"""<p:video><p:cMediaNode vol="100000"><p:cTn id="{nid}" fill="hold" display="0"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst></p:cTn>
<p:tgtEl><p:spTgt spid="{pic.shape_id}"/></p:tgtEl></p:cMediaNode></p:video>""")
        nid += 1
    xml = f"""<p:timing xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:tnLst><p:par>
<p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
<p:par><p:cTn id="3" fill="hold"><p:stCondLst><p:cond delay="indefinite"/><p:cond evt="onBegin" delay="0"><p:tn val="2"/></p:cond></p:stCondLst><p:childTnLst>
<p:par><p:cTn id="4" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>
{''.join(calls)}
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:prevCondLst>
<p:nextCondLst><p:cond evt="onNext" delay="0"><p:tgtEl><p:sldTgt/></p:tgtEl></p:cond></p:nextCondLst></p:seq>
{''.join(nodes)}
</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>"""
    sld = slide._element
    for old in sld.findall(qn("p:timing")):
        sld.remove(old)
    timing = etree.fromstring(xml)
    ext = sld.find(qn("p:extLst"))
    (ext.addprevious(timing) if ext is not None else sld.append(timing))


def round_corners(pic, radius_px, w_px, h_px):
    geom = pic._element.spPr.find(qn("a:prstGeom"))
    geom.set("prst", "roundRect")
    av = geom.find(qn("a:avLst"))
    if av is None:
        av = etree.SubElement(geom, qn("a:avLst"))
    gd = etree.SubElement(av, qn("a:gd"))
    gd.set("name", "adj"); gd.set("fmla", f"val {int(radius_px / min(w_px, h_px) * 100000)}")


def main():
    TMP.mkdir(exist_ok=True)
    data = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(executable_path=CHROME, headless=True)
        page = browser.new_page(viewport={"width": W_PX, "height": H_PX}, device_scale_factor=2)
        n_slides = None
        n = 1
        while True:
            page.goto(f"{DECK.as_uri()}#{n}"); page.reload(); page.wait_for_timeout(600)
            if n_slides is None:
                n_slides = page.evaluate("document.querySelectorAll('.slide').length")
            page.add_style_tag(content=FREEZE_CSS)
            page.evaluate("document.querySelectorAll('video').forEach(v => v.pause())")
            page.wait_for_timeout(300)
            info = page.evaluate(EXTRACT_JS, TEXT_SELECTOR)
            page.add_style_tag(content=HIDE_TEXT_CSS)
            page.wait_for_timeout(200)
            bg = TMP / f"bg-{n}.jpg"
            page.screenshot(path=str(bg), type="jpeg", quality=90)
            info["bg"] = bg
            data.append(info)
            print(f"slide {n}: {len(info['texts'])} text boxes, {len(info['videos'])} video(s)")
            n += 1
            if n > n_slides:
                break
        browser.close()

    durations = {"demo-distracted.mp4": 53005, "demo-aggressive.mp4": 42608, "demo-visionpro.mp4": 53000}
    prs = Presentation()
    prs.slide_width, prs.slide_height = SLIDE_W, SLIDE_H
    blank = prs.slide_layouts[6]
    for info in data:
        s = prs.slides.add_slide(blank)
        s.shapes.add_picture(str(info["bg"]), 0, 0, SLIDE_W, SLIDE_H)
        clips = []
        for v in info["videos"]:
            w, h = v["w"], v["h"]
            pic = s.shapes.add_movie(str(HERE / v["src"]), px(v["cx"] - w / 2), px(v["cy"] - h / 2), px(w), px(h),
                                     poster_frame_image=str(HERE / v["poster"]), mime_type="video/mp4")
            pic.rotation = v["rot"]
            round_corners(pic, v["radius"], w, h)
            clips.append((pic, v["start"], int(durations.get(Path(v["src"]).name, 60000) - v["start"] * 1000)))
        if clips:
            autoplay(s, clips)
        for block in info["texts"]:
            add_text(s, block)
        s.notes_slide.notes_text_frame.text = info["notes"]
    prs.save(OUT)
    print("wrote", OUT.name, round(OUT.stat().st_size / 1e6, 1), "MB")


if __name__ == "__main__":
    main()
