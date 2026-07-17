import sys
import glob
import re

def optimize_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    # Pattern for inspect.stack
    # we want to replace inspect.stack() logic
    pattern = r"import inspect\s*for frame_info in inspect\.stack\(\)\[1.*?\]:\s*frame = frame_info\.frame"
    
    replacement = "try:\n            f = sys._getframe(1)\n            for _ in range(15):\n                if f is None: break\n                locs = f.f_locals\n"
    
    # Let's use a simpler approach: replace the inspect string manually
    
    if "inspect.stack" in content:
        content = content.replace("import inspect", "import sys")
        content = content.replace("for frame_info in inspect.stack()[1:]:", "try:\n            f = sys._getframe(1)\n            for _ in range(15):\n                if f is None: break\n                locs = f.f_locals")
        content = content.replace("for frame_info in inspect.stack()[1:10]:", "try:\n            f = sys._getframe(1)\n            for _ in range(15):\n                if f is None: break\n                locs = f.f_locals")
        content = content.replace("frame = frame_info.frame", "")
        content = content.replace("frame.f_locals", "locs")
        content = content.replace("                    break", "                    break\n                f = f.f_back\n        except Exception:\n            pass")
        
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f"Optimized {filepath}")

for f in ["helpers.py", "config.py"]:
    optimize_file(f)

