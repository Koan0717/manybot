import re
with open('dashboard/src/app/dashboard/[guild_id]/rooms/page.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

target1 = '''  const [rolePrices, setRolePrices] = useState<any>(defaultRolePrices);

  // Panel deployment states'''
replacement1 = '''  const [rolePrices, setRolePrices] = useState<any>(defaultRolePrices);

  // Panel configuration states
  const defaultPanelConfigs = {
    inn: { allowTemp: true, allowMainSub: false, categoryId: '' },
    inn_combined: { allowTemp: true, allowMainSub: true, categoryId: '' },
    main_inn: { allowTemp: false, allowMainSub: true, categoryId: '' },
    luxury_inn_single: { allowTemp: true, allowMainSub: true, categoryId: '' }
  };
  const [panelConfigs, setPanelConfigs] = useState<any>(defaultPanelConfigs);
  const [expandedPanels, setExpandedPanels] = useState<{ [key: string]: boolean }>({});

  // Panel deployment states'''
content = content.replace(target1, replacement1)

target2 = '''      if (roomsData.role_prices) {'''
replacement2 = '''      if (roomsData.roomPanelConfigs) {
        setPanelConfigs((prev: any) => ({ ...prev, ...roomsData.roomPanelConfigs }));
      }
      if (roomsData.role_prices) {'''
content = content.replace(target2, replacement2)

target3 = '''      const res = await fetch(`/api/guilds/${guildId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ROOM_PRICES: prices, toggles, role_prices: flattenedRolePrices })
      });'''
replacement3 = '''      const res = await fetch(`/api/guilds/${guildId}/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', ROOM_PRICES: prices, toggles, role_prices: flattenedRolePrices, ROOM_PANEL_CONFIGS: panelConfigs })
      });'''
content = content.replace(target3, replacement3)

target4 = '''            <div key={panel.id} className="flex flex-col md:flex-row items-center justify-between bg-zinc-900 p-4 rounded border border-zinc-700 gap-4">
              <div className="flex-1">
                <h3 className="font-bold text-white text-lg">{panel.name}</h3>
                <p className="text-xs text-zinc-400 mt-1">{panel.desc}</p>
              </div>'''
replacement4 = '''            <div key={panel.id} className="bg-zinc-900 rounded border border-zinc-700 overflow-hidden">
              <div className="flex flex-col md:flex-row items-center justify-between p-4 gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-bold text-white text-lg">{panel.name}</h3>
                    {panelConfigs[panel.id] && (
                      <button 
                        onClick={() => setExpandedPanels(prev => ({ ...prev, [panel.id]: !prev[panel.id] }))}
                        className="text-xs bg-zinc-700 hover:bg-zinc-600 px-2 py-1 rounded text-white transition-colors"
                      >
                        {expandedPanels[panel.id] ? '設定を閉じる' : '設定を開く'}
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-zinc-400 mt-1">{panel.desc}</p>
                </div>'''
content = content.replace(target4, replacement4)

target5 = '''              <button
                onClick={() => handleDeployPanel(panel.id)}
                disabled={deploying[panel.id] || !selectedChannels[panel.id]}
                className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded font-bold shadow transition-colors whitespace-nowrap"
              >
                {deploying[panel.id] ? 'リクエスト中...' : 'パネルを設置'}
              </button>
            </div>'''
replacement5 = '''                <button
                  onClick={() => handleDeployPanel(panel.id)}
                  disabled={deploying[panel.id] || !selectedChannels[panel.id]}
                  className="w-full md:w-auto bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white px-4 py-2 rounded font-bold shadow transition-colors whitespace-nowrap"
                >
                  {deploying[panel.id] ? 'リクエスト中...' : 'パネルを設置'}
                </button>
              </div>
              
              {expandedPanels[panel.id] && panelConfigs[panel.id] && (
                <div className="bg-zinc-800/50 p-4 border-t border-zinc-700">
                  <h4 className="font-bold text-white mb-4 text-sm">■ {panel.name} の設定</h4>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="text-sm text-white font-bold">仮メンバーの利用を許可</span>
                      <label className="flex items-center cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" className="sr-only" 
                            checked={panelConfigs[panel.id].allowTemp}
                            onChange={(e) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], allowTemp: e.target.checked } }))}
                          />
                          <div className={`block w-12 h-7 rounded-full transition-colors ${panelConfigs[panel.id].allowTemp ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${panelConfigs[panel.id].allowTemp ? 'transform translate-x-5' : ''}`}></div>
                        </div>
                      </label>
                    </div>

                    <div className="flex items-center justify-between bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="text-sm text-white font-bold">本・準メンバーの利用を許可</span>
                      <label className="flex items-center cursor-pointer">
                        <div className="relative">
                          <input type="checkbox" className="sr-only" 
                            checked={panelConfigs[panel.id].allowMainSub}
                            onChange={(e) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], allowMainSub: e.target.checked } }))}
                          />
                          <div className={`block w-12 h-7 rounded-full transition-colors ${panelConfigs[panel.id].allowMainSub ? 'bg-red-500' : 'bg-zinc-600'}`}></div>
                          <div className={`dot absolute left-1 top-1 bg-white w-5 h-5 rounded-full transition-transform ${panelConfigs[panel.id].allowMainSub ? 'transform translate-x-5' : ''}`}></div>
                        </div>
                      </label>
                    </div>

                    <div className="bg-zinc-800 p-3 rounded border border-zinc-700">
                      <span className="block text-sm text-white font-bold mb-2">作成先のカテゴリー</span>
                      <p className="text-xs text-zinc-400 mb-2">指定しない場合は、パネルと同じカテゴリーに部屋が作られます。</p>
                      <Select
                        options={[{value: '', label: '指定なし (パネルと同じカテゴリー)'}, ...channels.filter(c => c.type === 4).map(c => ({ value: c.id, label: `📁 ${c.name}` }))]}
                        value={panelConfigs[panel.id].categoryId ? {value: panelConfigs[panel.id].categoryId, label: `📁 ${channels.find(c => c.id === panelConfigs[panel.id].categoryId)?.name || '不明'}`} : {value: '', label: '指定なし (パネルと同じカテゴリー)'}}
                        onChange={(selected: any) => setPanelConfigs((prev: any) => ({ ...prev, [panel.id]: { ...prev[panel.id], categoryId: selected?.value || '' } }))}
                        styles={customStyles}
                        placeholder="カテゴリーを選択..."
                      />
                    </div>
                    
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={handleSavePrices}
                        disabled={saving}
                        className="bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white px-4 py-2 rounded font-bold shadow transition-colors text-sm"
                      >
                        {saving ? '保存中...' : '設定を保存'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>'''
content = content.replace(target5, replacement5)

with open('dashboard/src/app/dashboard/[guild_id]/rooms/page.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
