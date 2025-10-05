let cy;
let currentCompany = null;
let currentRelations = [];
let graphControlBuilt = false;
let currentLayout = 'cose';
let selectedEdge = null;
let edgeAdjustmentMode = false;

const filterState = {
  subsidiary: true,
  parent: true,
  owned_by: true
};

const edgeStyles = {
  curveStyle: 'bezier',
  controlPointDistances: [40],
  controlPointWeights: [0.5]
};

export function resetGraph(){
  if(!cy){
    cy = cytoscape({
      container: document.getElementById('graph'),
      elements: [],
      style: [
        {
          selector: 'node',
          style: {
            'background-color': '#4aa3ff',
            'label': 'data(label)',
            'color': '#ffffff',
            'font-size': '14px',
            'font-weight': 'bold',
            'text-wrap': 'wrap',
            'text-max-width': '140px',
            'text-outline-color': '#001a33',
            'text-outline-width': '2px',
            'text-valign': 'center',
            'text-halign': 'center',
            'width': '60px',
            'height': '60px',
            'border-width': '2px',
            'border-color': '#0066cc'
          }
        },
        {
          selector: 'node[type="company"]',
          style: {
            'background-color': '#ffcc00',
            'color': '#000000',
            'text-outline-color': '#fff8e1',
            'text-outline-width': '3px',
            'font-size': '16px',
            'font-weight': '900',
            'width': '80px',
            'height': '80px',
            'border-width': '3px',
            'border-color': '#ff9900'
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 3,
            'line-color': '#00d9ff',
            'target-arrow-color': '#00d9ff',
            'target-arrow-shape': 'triangle',
            'arrow-scale': 2,
            'curve-style': 'data(curveStyle)',
            'control-point-distances': 'data(controlPointDistances)',
            'control-point-weights': 'data(controlPointWeights)',
            'label': 'data(label)',
            'font-size': '12px',
            'font-weight': '700',
            'color': '#ffffff',
            'text-background-color': '#001a33',
            'text-background-opacity': 0.9,
            'text-background-padding': '4px',
            'text-border-color': '#00d9ff',
            'text-border-width': 1,
            'text-border-opacity': 0.8
          }
        },
        {
          selector: 'edge:selected',
          style: {
            'line-color': '#ff2a6d',
            'target-arrow-color': '#ff2a6d',
            'width': 5,
            'text-border-color': '#ff2a6d'
          }
        }
      ],
      layout: { name: currentLayout, animate: false }
    });
  } else {
    cy.elements().remove();
  }

  ensureGraphControl();
}

export function buildGraph(company, relations){
  if(!cy) resetGraph();
  currentCompany = company;
  currentRelations = Array.isArray(relations) ? relations : [];
  renderGraph();
}

function renderGraph(){
  if(!cy || !currentCompany) return;
  cy.elements().remove();

  const filteredRelations = currentRelations.filter(rel => filterState[rel.type] !== false);
  const addedNodes = new Set();

  const companyId = currentCompany.qid || 'company';
  const companyLabel = currentCompany.label || companyId;

  cy.add({
    group: 'nodes',
    data: {
      id: companyId,
      label: companyLabel,
      type: 'company'
    }
  });
  addedNodes.add(companyId);

  filteredRelations.forEach(rel => {
    const targetId = rel.targetQ || `rel-${Math.random()}`;
    if(!addedNodes.has(targetId)){
      cy.add({
        group: 'nodes',
        data: {
          id: targetId,
          label: rel.targetLabel || targetId
        }
      });
      addedNodes.add(targetId);
    }

    const edgeId = `${companyId}-${rel.type || 'related'}-${targetId}`;
    const isParent = rel.type === 'parent';

    // Use saved edge style if exists, otherwise use defaults
    const savedStyle = cy && cy.$id(edgeId).length > 0 ? {
      curveStyle: cy.$id(edgeId).data('curveStyle'),
      controlPointDistances: cy.$id(edgeId).data('controlPointDistances'),
      controlPointWeights: cy.$id(edgeId).data('controlPointWeights')
    } : edgeStyles;

    cy.add({
      group: 'edges',
      data: {
        id: edgeId,
        source: isParent ? targetId : companyId,
        target: isParent ? companyId : targetId,
        label: relationLabel(rel.type),
        curveStyle: savedStyle.curveStyle || 'bezier',
        controlPointDistances: savedStyle.controlPointDistances || [40],
        controlPointWeights: savedStyle.controlPointWeights || [0.5]
      }
    });
  });

  cy.layout({ name: currentLayout, animate: false }).run();

  // Re-attach edge click handler
  attachEdgeHandlers();
}

function attachEdgeHandlers(){
  if(!cy) return;

  cy.off('select', 'edge');
  cy.off('unselect', 'edge');

  cy.on('select', 'edge', (evt) => {
    const edge = evt.target;
    selectedEdge = edge;
    showEdgeAdjustmentPanel(edge);
  });

  cy.on('unselect', 'edge', () => {
    selectedEdge = null;
    hideEdgeAdjustmentPanel();
  });
}

function showEdgeAdjustmentPanel(edge){
  let panel = document.getElementById('edgeAdjustPanel');
  if(!panel){
    panel = document.createElement('div');
    panel.id = 'edgeAdjustPanel';
    panel.className = 'edge-adjust-panel';
    document.body.appendChild(panel);
  }

  const curveStyle = edge.data('curveStyle') || 'bezier';
  const distances = edge.data('controlPointDistances') || [40];
  const weights = edge.data('controlPointWeights') || [0.5];

  panel.innerHTML = `
    <div class="edge-adjust-header">
      <h4>🎯 矢印調整</h4>
      <button class="close-edge-adjust" title="閉じる">✕</button>
    </div>
    <div class="edge-adjust-body">
      <div class="edge-adjust-field">
        <label>曲線スタイル:</label>
        <select id="edgeCurveStyle">
          <option value="bezier" ${curveStyle === 'bezier' ? 'selected' : ''}>ベジェ曲線</option>
          <option value="unbundled-bezier" ${curveStyle === 'unbundled-bezier' ? 'selected' : ''}>自由ベジェ</option>
          <option value="straight" ${curveStyle === 'straight' ? 'selected' : ''}>直線</option>
          <option value="segments" ${curveStyle === 'segments' ? 'selected' : ''}>セグメント</option>
        </select>
      </div>
      <div class="edge-adjust-field" id="controlPointFields">
        <label>曲線の強さ:</label>
        <input type="range" id="edgeDistance" min="-200" max="200" value="${distances[0] || 40}" step="10">
        <span id="edgeDistanceValue">${distances[0] || 40}</span>
      </div>
      <div class="edge-adjust-field" id="controlWeightFields">
        <label>制御点位置:</label>
        <input type="range" id="edgeWeight" min="0" max="1" value="${weights[0] || 0.5}" step="0.1">
        <span id="edgeWeightValue">${weights[0] || 0.5}</span>
      </div>
      <div class="edge-adjust-actions">
        <button id="resetEdgeStyle" class="secondary">リセット</button>
        <button id="applyToAllEdges" class="primary">全矢印に適用</button>
      </div>
    </div>
  `;

  panel.style.display = 'block';

  // Event handlers
  const curveStyleSelect = panel.querySelector('#edgeCurveStyle');
  const distanceSlider = panel.querySelector('#edgeDistance');
  const distanceValue = panel.querySelector('#edgeDistanceValue');
  const weightSlider = panel.querySelector('#edgeWeight');
  const weightValue = panel.querySelector('#edgeWeightValue');
  const closeBtn = panel.querySelector('.close-edge-adjust');
  const resetBtn = panel.querySelector('#resetEdgeStyle');
  const applyAllBtn = panel.querySelector('#applyToAllEdges');

  const updateEdgeStyle = () => {
    if(!selectedEdge) return;
    const newCurveStyle = curveStyleSelect.value;
    const newDistance = parseFloat(distanceSlider.value);
    const newWeight = parseFloat(weightSlider.value);

    selectedEdge.data('curveStyle', newCurveStyle);
    selectedEdge.data('controlPointDistances', [newDistance]);
    selectedEdge.data('controlPointWeights', [newWeight]);

    // Update visibility of control fields
    const controlFields = panel.querySelector('#controlPointFields');
    const weightFields = panel.querySelector('#controlWeightFields');
    if(newCurveStyle === 'straight' || newCurveStyle === 'segments'){
      if(controlFields) controlFields.style.display = 'none';
      if(weightFields) weightFields.style.display = 'none';
    } else {
      if(controlFields) controlFields.style.display = 'flex';
      if(weightFields) weightFields.style.display = 'flex';
    }
  };

  curveStyleSelect.addEventListener('change', updateEdgeStyle);

  distanceSlider.addEventListener('input', () => {
    distanceValue.textContent = distanceSlider.value;
    updateEdgeStyle();
  });

  weightSlider.addEventListener('input', () => {
    weightValue.textContent = weightSlider.value;
    updateEdgeStyle();
  });

  closeBtn.addEventListener('click', () => {
    if(selectedEdge) selectedEdge.unselect();
    hideEdgeAdjustmentPanel();
  });

  resetBtn.addEventListener('click', () => {
    if(!selectedEdge) return;
    selectedEdge.data('curveStyle', 'bezier');
    selectedEdge.data('controlPointDistances', [40]);
    selectedEdge.data('controlPointWeights', [0.5]);

    curveStyleSelect.value = 'bezier';
    distanceSlider.value = 40;
    distanceValue.textContent = '40';
    weightSlider.value = 0.5;
    weightValue.textContent = '0.5';
  });

  applyAllBtn.addEventListener('click', () => {
    if(!selectedEdge || !cy) return;
    const newCurveStyle = selectedEdge.data('curveStyle');
    const newDistances = selectedEdge.data('controlPointDistances');
    const newWeights = selectedEdge.data('controlPointWeights');

    cy.edges().forEach(edge => {
      edge.data('curveStyle', newCurveStyle);
      edge.data('controlPointDistances', newDistances);
      edge.data('controlPointWeights', newWeights);
    });

    alert('すべての矢印に現在の設定を適用しました。');
  });

  // Initial visibility
  updateEdgeStyle();
}

function hideEdgeAdjustmentPanel(){
  const panel = document.getElementById('edgeAdjustPanel');
  if(panel) panel.style.display = 'none';
}

function ensureGraphControl(){
  if(graphControlBuilt) return;
  const graphEl = document.getElementById('graph');
  if(!graphEl || !graphEl.parentElement) return;
  const container = graphEl.parentElement;
  const control = document.createElement('div');
  control.className = 'graph-control';
  control.innerHTML = `
    <div class="graph-control-group">
      <strong style="color:var(--accent)">関係:</strong>
      <label><input type="checkbox" data-edge="subsidiary" ${filterState.subsidiary ? 'checked' : ''}>子会社</label>
      <label><input type="checkbox" data-edge="parent" ${filterState.parent ? 'checked' : ''}>親会社</label>
      <label><input type="checkbox" data-edge="owned_by" ${filterState.owned_by ? 'checked' : ''}>所有</label>
    </div>
    <div class="graph-control-group">
      <strong style="color:var(--accent)">レイアウト:</strong>
      <select data-layout>
        <option value="cose">フォース</option>
        <option value="breadthfirst">階層</option>
        <option value="circle">円形</option>
      </select>
    </div>
    <div class="graph-control-hint">
      <span style="color:var(--muted);font-size:11px;">💡 矢印をクリックして曲線を調整できます</span>
    </div>
  `;
  container.insertBefore(control, graphEl);

  const layoutSelect = control.querySelector('select[data-layout]');
  if(layoutSelect){
    layoutSelect.value = currentLayout;
    layoutSelect.addEventListener('change', () => {
      currentLayout = layoutSelect.value;
      if(cy){
        cy.layout({ name: currentLayout, animate: false }).run();
      }
    });
  }

  control.querySelectorAll('input[data-edge]').forEach(input => {
    input.addEventListener('change', () => {
      const type = input.dataset.edge;
      filterState[type] = input.checked;
      renderGraph();
    });
  });

  graphControlBuilt = true;
}

function relationLabel(type){
  switch(type){
    case 'subsidiary': return '子会社';
    case 'parent': return '親会社';
    case 'owned_by': return '所有';
    default: return type || '関連';
  }
}
