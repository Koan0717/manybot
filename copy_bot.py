import os
import shutil

src_dir = r"c:\Users\kakij\OneDrive\ドキュメント\多様化bot"
dst_dir = r"C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot"

def copy_files():
    for root, dirs, files in os.walk(src_dir):
        # Exclude directories we don't want to copy
        dirs[:] = [d for d in dirs if d not in ['.git', 'node_modules', 'dashboard', '__pycache__']]
        
        for file in files:
            src_file = os.path.join(root, file)
            # Calculate relative path
            rel_path = os.path.relpath(src_file, src_dir)
            dst_file = os.path.join(dst_dir, rel_path)
            
            dst_folder = os.path.dirname(dst_file)
            os.makedirs(dst_folder, exist_ok=True)
            
            # Copy only if it's not the script itself
            if not src_file.endswith('copy_bot.py'):
                try:
                    shutil.copy2(src_file, dst_file)
                except Exception as e:
                    print(f"Error copying {file}: {e}")
    print("Copy completed successfully!")

if __name__ == "__main__":
    copy_files()
