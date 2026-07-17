import discord

class MyView(discord.ui.View):
    def __init__(self):
        super().__init__()
        self.add_item(discord.ui.Button(label="現在、対応可能な司祭がいません", disabled=True))

try:
    v = MyView()
    print("View created successfully.")
except Exception as e:
    print(f"Exception: {e}")
