(function(){
  const CHARGE_TYPES=[
    ["inadimplentes","Cobrança inadimplente"],
    ["manuais","Cobranças manuais"],
    ["efetivadas","Cobranças efetivadas"]
  ];

  function activityCount(type,me){
    return type==="mensagens"?(me?.messages||0):(me?.activities?.[type]||0);
  }

  function compactCounter(type,count){
    return `<div class="compact-counter" role="group" aria-label="Controles de ${type}">
      <button class="counter-btn counter-minus" title="Diminuir" aria-label="Diminuir" onclick="activity('${type}',-1)">−</button>
      <span class="counter-value">${count}</span>
      <button class="counter-btn counter-plus" title="Adicionar" aria-label="Adicionar" onclick="activity('${type}',1)">+</button>
    </div>`;
  }

  function regularCard(type,label,me,pending){
    const count=activityCount(type,me);
    const warning=type==="cancelamentos"&&pending;
    const highlight=type==="mensagens";
    return `<div class="activity-btn activity-btn-round${warning?" has-pending":""}${highlight?" message-highlight":""}">
      ${warning?`<button class="warning-btn" title="Ver pendências" onclick="openCancellationPending()">⚠</button>`:""}
      <div class="activity-top">
        <div class="activity-icon ${ICON_CLASS[type]}">${ICONS[type]}</div>
        <div class="activity-info"><strong>${label}</strong><small class="activity-description">${DESCRIPTIONS[type]}</small></div>
      </div>
      <div class="activity-control-row">${compactCounter(type,count)}</div>
    </div>`;
  }

  function renderChargeCard(me){
    const rows=CHARGE_TYPES.map(([type,label])=>{
      const count=activityCount(type,me);
      return `<div class="charge-row charge-${type}">
        <span class="charge-label">${label}</span>
        ${compactCounter(type,count)}
      </div>`;
    }).join("");
    return `<div class="activity-btn charge-group-card">
      <div class="activity-top">
        <div class="activity-icon cobrancas">$</div>
        <div class="activity-info"><strong>Cobranças</strong><small class="activity-description">Acompanhe os contatos e pagamentos.</small></div>
      </div>
      <div class="charge-list">${rows}</div>
    </div>`;
  }

  function finishCard(){
    return `<div class="finish-grid-card">
      <button id="shiftTimer" class="time-card shift-time" onclick="toggleShiftTimer()" title="Clique para alternar a visualização">
        <span class="time-icon">◷</span><span><small id="shiftTimerLabel">Tempo restante</small><strong id="shiftTimerValue">06:00:00</strong></span>
      </button>
      <div class="break-time-wrap">
        <button id="breakButton" class="time-card break-time" onclick="startBreak()"><span class="time-icon">☕</span><span><small>Intervalo obrigatório</small><strong>Iniciar 15 minutos</strong></span></button>
        <button id="breakFinishButton" class="break-finish hidden" onclick="requestFinishBreak()">Finalizar contagem</button>
      </div>
      <button class="finish-grid-btn" onclick="finishShift()">
        <span class="finish-grid-icon">✓</span><strong>Finalizar expediente</strong>
      </button>
    </div>`;
  }

  function activityChart(me){
    const metrics=[
      {label:"Mensagens",value:activityCount("mensagens",me),color:"#2563eb"},
      {label:"Vendas",value:activityCount("matriculas",me),color:"#7c3aed"},
      {label:"Cancelamentos",value:activityCount("cancelamentos",me),color:"#f97316"},
      {label:"Inadimplentes",value:activityCount("inadimplentes",me),color:"#718096"},
      {label:"Cobranças manuais",value:activityCount("manuais",me),color:"#34a853"},
      {label:"Cobranças efetivadas",value:activityCount("efetivadas",me),color:"#0f7a4a"},
      {label:"Treinos",value:activityCount("agendamentos",me),color:"#3b82f6"},
      {label:"Visitas",value:activityCount("visitas",me),color:"#8b5cf6"},
      {label:"NPS",value:activityCount("nps",me),color:"#a855f7"}
    ];
    const total=metrics.reduce((sum,item)=>sum+item.value,0);
    let cursor=0;
    const segments=metrics.filter(item=>item.value>0).map(item=>{
      const start=cursor;
      cursor+=item.value/total*100;
      return `${item.color} ${start}% ${cursor}%`;
    });
    const background=total?`conic-gradient(${segments.join(",")})`:"#eef2f5";
    const legend=metrics.map(item=>`<div class="activity-chart-legend-item"><span class="chart-dot" style="background:${item.color}"></span><span>${item.label}</span><strong>${item.value}</strong></div>`).join("");
    return `<aside class="activity-chart-card">
      <div><span class="activity-chart-kicker">Resumo em tempo real</span><h3>Atividades do expediente</h3></div>
      <div class="activity-donut" style="background:${background}"><div class="activity-donut-center"><strong>${total}</strong><span>Total</span></div></div>
      ${total?`<div class="activity-chart-legend">${legend}</div>`:`<div class="activity-chart-empty">Nenhuma atividade registrada</div>`}
    </aside>`;
  }

  window.renderActivities=function(){
    const me=state.sessionStats||state.stats?.rows?.find(x=>x.id===state.consultant.id);
    const pending=hasCancellationPending();
    const primary=[
      regularCard("mensagens","Mensagens",me,pending),
      regularCard("agendamentos","Agendamentos de treino",me,pending),
      regularCard("visitas","Visitas recebidas",me,pending)
    ].join("");
    const secondary=[
      regularCard("matriculas","Matrículas",me,pending),
      regularCard("nps","NPS",me,pending),
      regularCard("cancelamentos","Cancelamentos",me,pending)
    ].join("");
    const special=[renderChargeCard(me),finishCard()].join("");
    document.getElementById("activityButtons").innerHTML=`<div class="activity-cards-grid">
      <div class="activity-card-column" data-activity-column="primary">${primary}</div>
      <div class="activity-card-column" data-activity-column="secondary">${secondary}</div>
      <div class="activity-card-column" data-activity-column="special">${special}</div>
    </div>${activityChart(me)}`;
  };
})();
