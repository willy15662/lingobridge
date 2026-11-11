#!/usr/bin/env python3
"""Package only verified extension build files, with deterministic ZIP timestamps."""
from pathlib import Path
import zipfile,hashlib,json
root=Path('dist')
assert (root/'manifest.json').is_file()
output=Path('local-bilingual-reading.zip')
with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_DEFLATED) as archive:
 for path in sorted(root.rglob('*')):
  if path.is_file() and not path.name.endswith('.map'):
   entry=zipfile.ZipInfo(path.relative_to(root).as_posix(),(2026,1,1,0,0,0))
   entry.compress_type=zipfile.ZIP_DEFLATED
   archive.writestr(entry,path.read_bytes())
with zipfile.ZipFile(output) as archive:
 assert archive.testzip() is None
 assert not any(name.endswith('.map') for name in archive.namelist())
 manifest=json.loads(archive.read('manifest.json'))
 assert manifest['background']['service_worker'] in archive.namelist()
print(json.dumps({'archive':str(output),'bytes':output.stat().st_size,'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}))
