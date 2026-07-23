import os

def search_dashboard():
    dashboard_dir = r"c:\Users\kakij\OneDrive\ドキュメント\多様化bot\dashboard"
    if not os.path.exists(dashboard_dir):
        dashboard_dir = r"C:\Users\kakij\OneDrive\ドキュメント\GitHub\manybot\dashboard"
    
    for root, dirs, files in os.walk(dashboard_dir):
        for f in files:
            if 'antigrief' in f.lower() or 'antigrief' in root.lower():
                full_path = os.path.join(root, f)
                print("FOUND:", full_path)
                with open(full_path, 'r', encoding='utf-8') as file:
                    print("--- CONTENT START ---")
                    print(file.read())
                    print("--- CONTENT END ---")

if __name__ == '__main__':
    search_dashboard()
