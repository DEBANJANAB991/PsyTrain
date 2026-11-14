"""Build pitch-standalone.html: index.html with every image and video embedded (one file, works offline)."""
import base64, re, pathlib
here = pathlib.Path(__file__).parent
html = (here / 'index.html').read_text()
MIME = {'.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4'}
def b64(name): return base64.b64encode((here / 'media' / name).read_bytes()).decode()
videos = {}
def video_src(m):
    name = m.group(1); vid = 'blob-' + re.sub(r'\W', '-', name); videos[vid] = name
    return f'data-blob="{vid}"'
# videos: decoded into Blob URLs at load (reliable seeking); images: data URIs
html = re.sub(r'src="media/([^"]+\.mp4)"', video_src, html)
html = re.sub(r'(src|poster)="media/([^"]+\.(?:jpg|png))"', lambda m: f'{m.group(1)}="data:{MIME[pathlib.Path(m.group(2)).suffix]};base64,{b64(m.group(2))}"', html)
html = re.sub(r'url\(media/([^)]+\.(?:jpg|png))\)', lambda m: f'url(data:{MIME[pathlib.Path(m.group(1)).suffix]};base64,{b64(m.group(1))})', html)
blobs = ''.join(f'<script type="application/octet-stream" id="{vid}">{b64(name)}</script>\n' for vid, name in videos.items())
loader = """<script>
  for (const v of document.querySelectorAll('video[data-blob]')) {
    const bin = atob(document.getElementById(v.dataset.blob).textContent);
    const u = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    v.src = URL.createObjectURL(new Blob([u], { type: 'video/mp4' }));
  }
</script>
"""
# blobs + loader must run before the deck script (which plays the first video on show())
html = html.replace('<div id="notes"></div>', blobs + loader + '<div id="notes"></div>', 1)
assert 'media/' not in html, re.findall(r'media/[^"\')]+', html)
(here / 'pitch-standalone.html').write_text(html)
print('wrote pitch-standalone.html', round(len(html) / 1e6, 1), 'MB')
