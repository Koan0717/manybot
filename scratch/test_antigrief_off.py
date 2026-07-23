import helpers

class DummyBot:
    def __init__(self, settings):
        self.bot_settings = settings

def test():
    bot = DummyBot({
        12345: {"ENABLE_ANTIGRIEF": "false"}
    })
    val = helpers.get_setting(bot, "ENABLE_ANTIGRIEF", 12345)
    print(f"Setting for 12345 when false: {val} (type={type(val)})")
    
    val_bool = val if val is not None else True
    if isinstance(val_bool, str):
        val_bool = val_bool.lower() == "true"
    print(f"Parsed boolean: {val_bool}")
    assert val_bool == False, "Expected False!"
    print("Test passed successfully!")

if __name__ == "__main__":
    test()
