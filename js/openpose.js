import {app} from "/scripts/app.js";
import "./fabric.min.js";

const connect_keypoints = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [1, 5], [5, 6], [6, 7], [1, 8],
    [8, 9], [9, 10], [1, 11], [11, 12],
    [12, 13], [14, 0], [14, 16], [15, 0],
    [15, 17]
]

const connect_color = [
    [0, 0, 255],
    [255, 0, 0],
    [255, 170, 0],
    [255, 255, 0],
    [255, 85, 0],
    [170, 255, 0],
    [85, 255, 0],
    [0, 255, 0],

    [0, 255, 85],
    [0, 255, 170],
    [0, 255, 255],
    [0, 170, 255],
    [0, 85, 255],
    [85, 0, 255],

    [170, 0, 255],
    [255, 0, 255],
    [255, 0, 170],
    [255, 0, 85]
]

const DEFAULT_KEYPOINTS = [
    [241, 77, 1], [241, 120, 1], [191, 118, 1], [177, 183, 1],
    [163, 252, 1], [298, 118, 1], [317, 182, 1], [332, 245, 1],
    [225, 241, 1], [213, 359, 1], [215, 454, 1], [270, 240, 1],
    [282, 360, 1], [286, 456, 1], [232, 59, 1], [253, 60, 1],
    [225, 70, 1], [260, 72, 1]
]

const DEFAULT_FRAME = {
    "width": 512,
    "height": 512,
    "pose2d": DEFAULT_KEYPOINTS,
    "image": undefined
}

async function readFileToText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async () => {
            resolve(reader.result);
        };
        reader.onerror = async () => {
            reject(reader.error);
        }
        reader.readAsText(file);
    })
}

async function loadImageAsync(imageURL) {
    return new Promise((resolve) => {
        const e = new Image();
        e.setAttribute('crossorigin', 'anonymous');
        e.addEventListener("load", () => {
            resolve(e);
        });
        e.src = imageURL;
        return e;
    });
}

async function canvasToBlob(canvas) {
    return new Promise(function (resolve) {
        canvas.toBlob(resolve);
    });
}

function getPosesFromAux(poseNode) {
    let results = [];

    if (!(poseNode.id in app.nodeOutputs) || !("openpose_json" in app.nodeOutputs[poseNode.id])) {
        return results;
    }

    let openpose_json = [];
    for (const json_str of app.nodeOutputs[poseNode.id].openpose_json) {
        openpose_json.push(JSON.parse(json_str))
    }


    for (let i = 0; i < openpose_json.length; i++) {
        const openpose = openpose_json[i];
        let result = {}
        const canvas_width = openpose["canvas_width"]
        const canvas_height = openpose["canvas_height"]
        result["width"] = canvas_width
        result["height"] = canvas_height

        // TODO: support face and hand keypoints
        result["pose2d"] = []
        result["pose2d_visible"] = []
        result["face2d"] = []
        result["hand_left2d"] = []
        result["hand_right2d"] = []
        result["image"] = {}

        let last_x = 0
        let last_y = 0
        let peoples = openpose["people"]

        for (const people of peoples) {
            let kp = people["pose_keypoints_2d"]
            for (let id = 0; id < kp.length; id += 3) {
                let x = kp[id] <= 1 ? kp[id] * canvas_width : kp[id]
                let y = kp[id + 1] <= 1 ? kp[id + 1] * canvas_height : kp[id + 1]
                let f = kp[id + 2]
                if (f === 1) {
                    last_x = x
                    last_y = y
                } else {
                    x = last_x + 1
                    y = last_y + 1
                }
                result["pose2d"].push([x, y, 1])
            }
        }

        results.push(result)
    }

    return results;
}

function createCanvasBackground(img, width, height) {
    let imgInstance = undefined;
    if (img) {

        imgInstance = new fabric.Image(img, {
            left: 0,
            top: 0,
            selectable: false,
            hasBorders: false,
            hasControls: false,
            hasRotatingPoint: false
        });
        imgInstance.scaleToWidth(width)
        imgInstance.scaleToHeight(height)
    }
    return imgInstance
}

class OpenPosePanel {
    node = null;
    canvas = null;
    canvasElem = null
    panel = null

    undo_history = []
    redo_history = []

    visibleEyes = true;
    flipped = false;
    lockMode = false;

    constructor(panel, node) {
        this.panel = panel;
        this.node = node;
        this.last_aux_poses = this.node.properties.savedLastPoses
        this.last_frame_idx = this.node.properties.savedLastFrameIdx
        this.last_frame_idx = this.last_frame_idx === undefined ? 0 : this.last_frame_idx

        const height = window.innerHeight * (1.0 - 0.15);
        const width = Math.min(window.innerWidth * (1.0 - 0.15), height);
        this.panel.style.width = `${width}px`;
        this.panel.style.height = `${height}px`;
        this.panel.style.left = `calc(50% - ${width / 4}px)`
        this.panel.style.top = `calc(50% - ${height / 4}px)`

        const rootHtml = `
<canvas class="openpose-editor-canvas" />
<div class="canvas-drag-overlay" />
<input bind:this={fileInput} class="openpose-file-input" type="file" accept=".json" />
`;
        const container = this.panel.addHTML(rootHtml, "openpose-container");
        container.style.width = "100%";
        container.style.height = "100%";
        container.style.margin = "auto";
        container.style.display = "flex";

        const dragOverlay = container.querySelector(".canvas-drag-overlay")
        dragOverlay.style.pointerEvents = "none";
        dragOverlay.style.visibility = "hidden";
        dragOverlay.style.display = "flex";
        dragOverlay.style.alignItems = "center";
        dragOverlay.style.justifyContent = "center";
        dragOverlay.style.width = "100%";
        dragOverlay.style.height = "100%";
        dragOverlay.style.color = "white";
        dragOverlay.style.fontSize = "2.5em";
        dragOverlay.style.fontFamily = "inherit";
        dragOverlay.style.fontWeight = "600";
        dragOverlay.style.lineHeight = "100%";
        dragOverlay.style.background = "rgba(0,0,0,0.5)";
        dragOverlay.style.margin = "0.25rem";
        dragOverlay.style.borderRadius = "0.25rem";
        dragOverlay.style.border = "0.5px solid";
        dragOverlay.style.position = "absolute";

        // Find the openpose node link to this node.
        const openpose_node_link = this.node.inputs.filter(input => "openpose_images" === input.name)[0].link

        if (openpose_node_link) {
            const openpose_node = app.graph._nodes_by_id[app.graph.links[openpose_node_link]["origin_id"]]
            this.poses = getPosesFromAux(openpose_node);
        } else {
            this.poses = []
            this.last_frame_idx = 0;
        }

        this.canvasWidth = this.poses.length > 0 ? this.poses[0]["width"] : DEFAULT_FRAME["width"];
        this.canvasHeight = this.poses.length > 0 ? this.poses[0]["height"] : DEFAULT_FRAME["height"];

        this.canvasElem = container.querySelector(".openpose-editor-canvas")
        this.canvasElem.width = this.canvasWidth
        this.canvasElem.height = this.canvasHeight
        this.canvasElem.style.margin = "0.25rem"
        this.canvasElem.style.borderRadius = "0.25rem"
        this.canvasElem.style.border = "0.5px solid"

        this.canvas = this.initCanvas(this.canvasElem)
        this.fileInput = container.querySelector(".openpose-file-input");
        this.fileInput.style.display = "none";
        this.fileInput.addEventListener("change", this.onLoad.bind(this))

        this.panel.addButton("Add", () => {
            this.addPose()
            this.saveToNode();
        });
        this.panel.addButton("Remove", () => {
            this.removePose()
            this.saveToNode();
        });
        this.panel.addButton("Reset", () => {
            this.resetCanvas()
            this.saveToNode();
        });
        this.panel.addButton("Save", () => this.save());
        this.panel.addButton("Load", () => this.load());

        const widthLabel = document.createElement("label")
        widthLabel.innerHTML = "Width"
        widthLabel.style.fontFamily = "Arial"
        widthLabel.style.padding = "0 0.5rem";
        widthLabel.style.color = "#ccc";
        this.widthInput = document.createElement("input")
        this.widthInput.style.background = "#1c1c1c";
        this.widthInput.style.color = "#aaa";
        this.widthInput.setAttribute("type", "number")
        this.widthInput.setAttribute("min", "64")
        this.widthInput.setAttribute("max", "4096")
        this.widthInput.setAttribute("step", "64")
        this.widthInput.setAttribute("type", "number")
        this.widthInput.addEventListener("change", () => {
            this.canvasWidth = this.widthInput.value
            this.canvasHeight = this.heightInput.value
            this.resizeCanvas(this.canvasWidth, this.canvasHeight);
            this.saveToNode();
        })

        const heightLabel = document.createElement("label")
        heightLabel.innerHTML = "Height"
        heightLabel.style.fontFamily = "Arial"
        heightLabel.style.padding = "0 0.5rem";
        heightLabel.style.color = "#aaa";
        this.heightInput = document.createElement("input")
        this.heightInput.style.background = "#1c1c1c";
        this.heightInput.style.color = "#ccc";
        this.heightInput.setAttribute("type", "number")
        this.heightInput.setAttribute("min", "64")
        this.heightInput.setAttribute("max", "4096")
        this.heightInput.setAttribute("step", "64")
        this.heightInput.addEventListener("change", () => {
            this.canvasWidth = this.widthInput.value
            this.canvasHeight = this.heightInput.value
            this.resizeCanvas(this.canvasWidth, this.canvasHeight);
            this.saveToNode();
        })

        this.panel.footer.appendChild(widthLabel);
        this.panel.footer.appendChild(this.widthInput);
        this.panel.footer.appendChild(heightLabel);
        this.panel.footer.appendChild(this.heightInput);

        const frameIdxLabel = document.createElement("label")
        const frameSizeLabel = document.createElement("label")
        frameIdxLabel.innerHTML = "Frame"
        frameIdxLabel.style.fontFamily = "Arial"
        frameIdxLabel.style.padding = "0 0.5rem";
        frameIdxLabel.style.color = "#aaa";
        frameSizeLabel.innerHTML = ` / ${this.poses.length > 0 ? this.poses.length : 1}`
        frameSizeLabel.style.fontFamily = "Arial"
        frameSizeLabel.style.padding = "0 0.5rem";
        frameSizeLabel.style.color = "#aaa";
        this.frameIdxInput = document.createElement("input")
        this.frameIdxInput.style.background = "#1c1c1c";
        this.frameIdxInput.style.color = "#ccc";
        this.frameIdxInput.setAttribute("type", "number")
        this.frameIdxInput.setAttribute("min", "1")
        this.frameIdxInput.setAttribute("max", `${this.poses.length > 0 ? this.poses.length : 1}`)
        this.frameIdxInput.setAttribute("step", "1")
        this.frameIdxInput.value = this.last_frame_idx + 1;
        this.frameIdxInput.addEventListener("change", () => {
            this.last_frame_idx = (+this.frameIdxInput.value) - 1;
            this.refreshFrame(this.getCurFrame())
        })


        this.panel.footer.appendChild(frameIdxLabel);
        this.panel.footer.appendChild(this.frameIdxInput);
        this.panel.footer.appendChild(frameSizeLabel);

        if (this.poses.length > 0) {

            if (this.last_aux_poses === undefined) {
                this.last_aux_poses = JSON.stringify(this.poses);
            }

            // if input image not change (means the poses not change)
            if (this.last_aux_poses === JSON.stringify(this.poses)) {
                // load last edited poses if exists.
                if (this.node.properties.savedPoses) {
                    this.poses = JSON.parse(this.node.properties.savedPoses)
                }
            } else {
                this.last_aux_poses = JSON.stringify(this.poses);
            }
        } else if (this.node.properties.savedPoses) {
            this.poses = JSON.parse(this.node.properties.savedPoses)
            this.undo_history.push(JSON.stringify(this.canvas));
        }

        let backgrounds = undefined;
        // Fetch all poses and backgrounds
        if (this.node.id in app.nodeOutputs && "backgrounds" in app.nodeOutputs[this.node.id]) {
            backgrounds = app.nodeOutputs[this.node.id]["backgrounds"]
        }

        if (backgrounds) {
            console.assert(backgrounds.length === this.poses.length)
            for (let i = 0; i < this.poses.length; i++) {
                const e = new Image();
                e.setAttribute('crossorigin', 'anonymous');
                e.src = `/view?filename=${backgrounds[i]["filename"]}&type=temp&subfolder=`;
                this.poses[i]["image"] = e;
            }
        }

        this.refreshFrame(this.getCurFrame())

        const keyHandler = this.onKeyDown.bind(this);

        document.addEventListener("keydown", keyHandler)
        this.panel.onClose = () => {
            document.removeEventListener("keydown", keyHandler)
        }
    }

    getCurFrame() {
        if (this.poses.length === 0) {
            return DEFAULT_FRAME;
        }
        return this.poses[this.last_frame_idx]
    }

    refreshFrame(frame) {
        this.resetCanvas()
        this.resizeCanvas(this.canvasWidth, this.canvasHeight)
        if (frame["image"] && frame["image"] !== {}) {
            fabric.util.loadImage(frame["image"].src).then((img) => {
                let imgInstance = new fabric.Image(img, {
                    left: 0,
                    top: 0,
                    selectable: false,
                    originX: 'left',
                    originY: 'top',
                })
                imgInstance.scaleToWidth(this.canvasWidth);
                imgInstance.scaleToHeight(this.canvasHeight);
                this.canvas.clear()
                this.canvas.add(imgInstance);
                this.setPose(frame["pose2d"], undefined, false)
            })
        } else {
            this.setPose(frame["pose2d"], undefined, true)
        }
    }

    onKeyDown(e) {
        if (e.key === "z" && e.ctrlKey) {
            this.undo()
            e.preventDefault();
            e.stopImmediatePropagation();
        } else if (e.key === "y" && e.ctrlKey) {
            this.redo()
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }

    addPose(keypoints = undefined, group_id = 0) {
        if (keypoints === undefined) {
            keypoints = DEFAULT_KEYPOINTS;
        }

        const group = new fabric.Group([], {
            subTargetCheck: true,
            interactive: true
        })

        group.id = group_id

        function makeCircle(color, left, top, line1, line2, line3, line4, line5) {
            var c = new fabric.Circle({
                left: left,
                top: top,
                strokeWidth: 1,
                radius: 5,
                fill: color,
                stroke: color,
                originX: 'center',
                originY: 'center',
            });
            c.hasControls = c.hasBorders = false;

            c.line1 = line1;
            c.line2 = line2;
            c.line3 = line3;
            c.line4 = line4;
            c.line5 = line5;

            return c;
        }

        function makeLine(coords, color, visible = true) {
            return new fabric.Line(coords, {
                fill: color,
                stroke: color,
                strokeWidth: 10,
                selectable: false,
                evented: false,
                originX: 'center',
                originY: 'center',
                visible: visible,
            });
        }

        const lines = []
        const circles = []

        for (let i = 0; i < connect_keypoints.length; i++) {
            const item = connect_keypoints[i]
            let p0 = keypoints[item[0]]
            let p1 = keypoints[item[1]]
            let visible = true;

            if (item[1] === 0) {
                visible = p0[2] === 1
            } else {
                visible = p1[2] === 1
            }
            const line = makeLine(
                [p0[0], p0[1], p1[0], p1[1]],
                `rgba(${connect_color[i].join(", ")}, 0.7)`, visible)
            lines.push(line)
            this.canvas.add(line)
            line['id'] = item[0];
        }

        for (let i = 0; i < keypoints.length; i++) {
            // const list = connect_keypoints.filter(item => item.includes(i));
            const list = []
            connect_keypoints.filter((item, idx) => {
                if (item.includes(i)) {
                    list.push(lines[idx])
                    return idx
                }
            })
            const circle = makeCircle(`rgb(${connect_color[i].join(", ")})`, keypoints[i][0], keypoints[i][1], ...list)
            circle["id"] = i
            circles.push(circle)
            // this.canvas.add(circle)
            group.add(circle);
        }

        group.lines = lines
        group.circles = circles

        this.canvas.discardActiveObject();
        this.canvas.setActiveObject(group);
        this.canvas.add(group);
        console.warn(group)
        // this.canvas.setActiveObject(group)
        // group.toActiveSelection();
        this.canvas.requestRenderAll();
    }

    setPose(keypoints, img = undefined, clear = true) {
        if (clear) {
            this.canvas.clear()
            this.canvas.backgroundColor = "#000"
        }

        const res = [];
        for (let i = 0; i < keypoints.length; i += 18) {
            const chunk = keypoints.slice(i, i + 18);
            res.push(chunk);
        }

        for (const item of res) {
            this.addPose(item)
            this.canvas.discardActiveObject();
        }

        this.saveToNode();
    }

    calcResolution(width, height) {
        const viewportWidth = window.innerWidth / 2.25;
        const viewportHeight = window.innerHeight * 0.75;
        const ratio = Math.min(viewportWidth / width, viewportHeight / height);
        return {width: width * ratio, height: height * ratio}
    }

    resizeCanvas(width, height) {
        let resolution = this.calcResolution(width, height)

        this.canvasWidth = width;
        this.canvasHeight = height;

        this.widthInput.value = `${width}`
        this.heightInput.value = `${height}`

        this.canvas.setWidth(width);
        this.canvas.setHeight(height);
        this.canvasElem.style.width = resolution["width"] + "px"
        this.canvasElem.style.height = resolution["height"] + "px"
        this.canvasElem.nextElementSibling.style.width = resolution["width"] + "px"
        this.canvasElem.nextElementSibling.style.height = resolution["height"] + "px"
        this.canvasElem.parentElement.style.width = resolution["width"] + "px"
        this.canvasElem.parentElement.style.height = resolution["height"] + "px"
        this.canvasElem.parentElement.style.margin = "auto";
    }

    undo() {
        if (this.undo_history.length > 0) {
            this.lockMode = true;
            if (this.undo_history.length > 1)
                this.redo_history.push(this.undo_history.pop());
            const content = this.undo_history[this.undo_history.length - 1];
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    redo() {
        if (this.redo_history.length > 0) {
            this.lockMode = true;
            const content = this.redo_history.pop();
            this.undo_history.push(content);
            this.canvas.loadFromJSON(content, () => {
                this.canvas.renderAll();
                this.lockMode = false;
            });
        }
    }

    initCanvas(elem) {
        const canvas = new fabric.Canvas(elem, {
            backgroundColor: '#000',
            // selection: false,
            preserveObjectStacking: true,
            fireRightClick: true,
            stopContextMenu: true
        });

        this.undo_history = [];
        this.redo_history = [];

        const updateLines = (target) => {
            if ("_objects" in target) {
                const flipX = target.flipX ? -1 : 1;
                const flipY = target.flipY ? -1 : 1;
                this.flipped = flipX * flipY === -1;
                const showEyes = this.flipped ? !this.visibleEyes : this.visibleEyes;

                if (target.angle === 0) {
                    const rtop = target.top
                    const rleft = target.left
                    for (const item of target._objects) {
                        let p = item;
                        p.scaleX = 1;
                        p.scaleY = 1;
                        const top = rtop + p.top * target.scaleY * flipY + target.height * target.scaleY / 2;
                        const left = rleft + p.left * target.scaleX * flipX + (target.width * target.scaleX / 2);
                        p['_top'] = top;
                        p['_left'] = left;
                        if (p["id"] === 0) {
                            p.line1 && p.line1.set({'x1': left, 'y1': top});
                        } else {
                            p.line1 && p.line1.set({'x2': left, 'y2': top});
                        }
                        if (p['id'] === 14 || p['id'] === 15) {
                            p.radius = showEyes ? 5 : 0;
                            p.strokeWidth = showEyes ? 10 : 0;
                        }
                        p.line2 && p.line2.set({'x1': left, 'y1': top});
                        p.line3 && p.line3.set({'x1': left, 'y1': top});
                        p.line4 && p.line4.set({'x1': left, 'y1': top});
                        p.line5 && p.line5.set({'x1': left, 'y1': top});

                    }
                } else {
                    const aCoords = target.aCoords;
                    const center = {'x': (aCoords.tl.x + aCoords.br.x) / 2, 'y': (aCoords.tl.y + aCoords.br.y) / 2};
                    const rad = target.angle * Math.PI / 180;
                    const sin = Math.sin(rad);
                    const cos = Math.cos(rad);

                    for (const item of target._objects) {
                        let p = item;
                        const p_top = p.top * target.scaleY * flipY;
                        const p_left = p.left * target.scaleX * flipX;
                        const left = center.x + p_left * cos - p_top * sin;
                        const top = center.y + p_left * sin + p_top * cos;
                        p['_top'] = top;
                        p['_left'] = left;
                        if (p["id"] === 0) {
                            p.line1 && p.line1.set({'x1': left, 'y1': top});
                        } else {
                            p.line1 && p.line1.set({'x2': left, 'y2': top});
                        }
                        if (p['id'] === 14 || p['id'] === 15) {
                            p.radius = showEyes ? 5 : 0.3;
                            if (p.line1) p.line1.strokeWidth = showEyes ? 10 : 0;
                            if (p.line2) p.line2.strokeWidth = showEyes ? 10 : 0;
                        }
                        p.line2 && p.line2.set({'x1': left, 'y1': top});
                        p.line3 && p.line3.set({'x1': left, 'y1': top});
                        p.line4 && p.line4.set({'x1': left, 'y1': top});
                        p.line5 && p.line5.set({'x1': left, 'y1': top});
                    }
                }
                target.setCoords();
            } else {
                const p = target;
                const group = p.group;

                const flipX = group.flipX ? -1 : 1;
                const flipY = group.flipY ? -1 : 1;
                this.flipped = flipX * flipY === -1;
                const showEyes = this.flipped ? !this.visibleEyes : this.visibleEyes;

                const aCoords = group.aCoords;
                const center = {'x': (aCoords.tl.x + aCoords.br.x) / 2, 'y': (aCoords.tl.y + aCoords.br.y) / 2};
                const rad = target.angle * Math.PI / 180;
                const sin = Math.sin(rad);
                const cos = Math.cos(rad);

                const p_top = p.top * group.scaleY * flipY;
                const p_left = p.left * group.scaleX * flipX;
                const left = center.x + p_left * cos - p_top * sin;
                const top = center.y + p_left * sin + p_top * cos;

                if (p["id"] === 0) {
                    p.line1 && p.line1.set({'x1': left, 'y1': top});
                } else {
                    p.line1 && p.line1.set({'x2': left, 'y2': top});
                }
                p.line2 && p.line2.set({'x1': left, 'y1': top});
                p.line3 && p.line3.set({'x1': left, 'y1': top});
                p.line4 && p.line4.set({'x1': left, 'y1': top});
                p.line5 && p.line5.set({'x1': left, 'y1': top});

                group.setCoords();
            }
            canvas.renderAll();
        }

        canvas.on('mouse:down', (e) => {
            if (e.button === 3 && e.target && e.target.type === "circle") { // 右键单击
                let circle = e.target
                if (circle.id === 0) {
                    return
                }
                if (circle.line1.get("visible")) {
                    circle.line1.set("visible", false)
                } else {
                    circle.line1.set("visible", true)
                }
                canvas.renderAll();
                this.saveToNode();
            }
        });

        canvas.on('object:moving', (e) => {
            updateLines(e.target);
        });

        canvas.on('object:scaling', (e) => {
            updateLines(e.target);
            canvas.renderAll();
        });

        canvas.on('object:rotating', (e) => {
            updateLines(e.target);
            canvas.renderAll();
        });

        canvas.on("object:modified", () => {
            if (this.lockMode) return;
            this.undo_history.push(JSON.stringify(canvas));
            this.redo_history.length = 0;
            this.saveToNode()
        });

        // const json_observer = new MutationObserver((m) => {
        //     if(gradioApp().querySelector('#tab_openpose_editor').style.display!=='block') return;
        //     try {
        //         const raw = gradioApp().querySelector("#jsonbox").querySelector("textarea").value
        //         if(raw.length!==0) detectImage(raw);
        //     } catch(e){console.log(e)}
        // })
        // json_observer.observe(gradioApp().querySelector("#jsonbox"), { "attributes": true })

        return canvas;
    }

    saveToNode() {

        let canvas_capture = this.captureToJSON()
        this.poses[this.last_frame_idx]["height"] = canvas_capture["height"]
        this.poses[this.last_frame_idx]["width"] = canvas_capture["width"]
        this.poses[this.last_frame_idx]["pose2d"] = canvas_capture["pose2d"]
        this.canvasWidth = canvas_capture["width"]
        this.canvasHeight = canvas_capture["height"]

        this.node.setProperty("savedPoses", this.serializeJSON());
        this.node.setProperty("savedLastPoses", this.last_aux_poses);
        this.node.setProperty("savedLastFrameIdx", this.last_frame_idx);
        this.uploadCanvasAsFile()
    }

    async captureCanvasClean() {
        this.lockMode = true;

        this.canvas.getObjects("image").forEach((img) => {
            img.opacity = 0;
        })
        if (this.canvas.backgroundImage)
            this.canvas.backgroundImage.opacity = 0

        const groups = this.canvas.getObjects().filter(i => i.type === "group");
        let circles = []
        for (const group of groups) {
            circles = circles.concat(group.getObjects().filter(i => i.type === "circle"))
        }

        for (const circle of circles) {
            circle.set("visible",  circle.line1.get("visible"))
        }

        this.canvas.discardActiveObject();
        this.canvas.renderAll()

        const blob = await canvasToBlob(this.canvasElem);

        this.canvas.getObjects("image").forEach((img) => {
            img.opacity = 1;
        })
        for (const circle of circles) {
            circle.set("visible",  true)
        }
        if (this.canvas.backgroundImage)
            this.canvas.backgroundImage.opacity = 0.5
        this.canvas.renderAll()

        this.lockMode = false;

        return blob
    }

    async uploadCanvasAsFile() {
        try {
            const blob = await this.captureCanvasClean()
            const filename = `ComfyUI_OpenPose_${this.node.id}_${this.last_frame_idx}.png`;

            const body = new FormData();
            body.append("image", blob, filename);
            body.append("overwrite", "true");

            const resp = await fetch("/upload/image", {
                method: "POST",
                body,
            });

            if (resp.status === 200) {
                const data = await resp.json();
                await this.node.setImage(data.name)
            } else {
                console.error(resp.status + " - " + resp.statusText)
                alert(resp.status + " - " + resp.statusText);
            }
        } catch (error) {
            console.error(error)
            alert(error);
        }
    }

    removePose() {
        const selection = this.canvas.getActiveObject();
        if (!selection || !("lines" in selection))
            return;

        for (const line of selection.lines) {
            this.canvas.remove(line)
        }

        this.canvas.remove(selection)
    }

    resetCanvas() {
        this.canvas.clear()
        this.canvas.backgroundColor = "#000"
    }

    load() {
        this.fileInput.value = null;
        this.fileInput.click();
    }

    async onLoad(e) {
        const file = this.fileInput.files[0];
        const text = await readFileToText(file);
        const error = await this.loadJSON(text);
        if (error != null) {
            app.ui.dialog.show(error);
        } else {
            this.saveToNode();
        }
    }

    captureToJSON() {
        const groups = this.canvas.getObjects().filter(i => i.type === "group");
        const keypoints = groups.map(g => {
            const circles = g.getObjects().filter(i => i.type === "circle");
            return circles.map(c =>
                [(c.oCoords.tl.x + c.oCoords.tr.x) / 2,
                    (c.oCoords.tl.y + c.oCoords.bl.y) / 2, c.line1.get("visible") ? 1 : 0])

        })
        return {
            "width": this.canvas.width,
            "height": this.canvas.height,
            "pose2d": keypoints.flat()
        }
    }

    serializeJSON() {
        return JSON.stringify(this.poses, null, 4);
    }

    save() {
        const json = this.serializeJSON()
        const blob = new Blob([json], {
            type: "application/json"
        });
        const filename = "pose-" + Date.now().toString() + ".json"
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        URL.revokeObjectURL(a.href);
    }

    loadJSON(text) {
        const json = JSON.parse(text);
        if (json["width"] && json["height"]) {
            this.resizeCanvas(json["width"], json["height"])
        } else {
            return 'width, height is invalid';
        }
        this.resetCanvas();
        const keypoints = json["keypoints"] || []
        for (const group of keypoints) {
            if (group.length % 18 === 0) {
                this.addPose(group)
            } else {
                return 'keypoints is invalid'
            }
        }
        return null;
    }
}

app.registerExtension({
    name: "Nui.OpenPoseEditor",

    async beforeRegisterNodeDef(nodeType, nodeData, app) {
        if (nodeData.name !== "Nui.OpenPoseEditor") {
            return
        }

        fabric.Object.prototype.transparentCorners = false;
        fabric.Object.prototype.cornerColor = '#108ce6';
        fabric.Object.prototype.borderColor = '#108ce6';
        fabric.Object.prototype.cornerSize = 10;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const r = onNodeCreated ? onNodeCreated.apply(this, arguments) : undefined;

            if (!this.properties) {
                this.properties = {};
                this.properties.savedPoses = "";
                this.properties.savedLastPoses = "";
                this.properties.savedLastImgSrc = "";
                this.properties.savedLastFrameIdx = 0;
            }

            this.serialize_widgets = true;

            // Output & widget
            this.imageWidget = this.widgets.find(w => w.name === "image");
            this.imageWidget.callback = this.showImage.bind(this);
            this.imageWidget.disabled = true
            console.error(this);

            // Non-serialized widgets
            this.jsonWidget = this.addWidget("text", "", this.properties.savedLastFrameIdx, "savedLastFrameIdx");
            this.jsonWidget.disabled = true
            this.jsonWidget.serialize = true
            this.jsonWidget = this.addWidget("text", "", this.properties.savedLastPoses, "savedLastPoses");
            this.jsonWidget.disabled = true
            this.jsonWidget.serialize = true
            this.jsonWidget = this.addWidget("text", "", this.properties.savedPoses, "savedPoses");
            this.jsonWidget.disabled = true
            this.jsonWidget.serialize = true

            this.openWidget = this.addWidget("button", "open editor", "image", () => {
                const graphCanvas = LiteGraph.LGraphCanvas.active_canvas
                if (graphCanvas == null)
                    return;

                const panel = graphCanvas.createPanel("OpenPose Editor", {closable: true});
                panel.node = this;
                panel.classList.add("openpose-editor");

                this.openPosePanel = new OpenPosePanel(panel, this);
                document.body.appendChild(this.openPosePanel.panel);
            });
            this.openWidget.serialize = false;

            // On load if we have a value then render the image
            // The value isnt set immediately so we need to wait a moment
            // No change callbacks seem to be fired on initial setting of the value
            requestAnimationFrame(async () => {
                if (this.imageWidget.value) {
                    await this.setImage(this.imageWidget.value);
                }
            });
        }

        nodeType.prototype.showImage = async function (name) {
            let folder_separator = name.lastIndexOf("/");
            let subfolder = "";
            if (folder_separator > -1) {
                subfolder = name.substring(0, folder_separator);
                name = name.substring(folder_separator + 1);
            }
            const img = await loadImageAsync(`/view?filename=${name}&type=input&subfolder=${subfolder}`);
            this.imgs = [img];
            this.setSizeForImage();
            app.graph.setDirtyCanvas(true);
        }

        nodeType.prototype.setImage = async function (name) {
            this.imageWidget.value = name;
            await this.showImage(name);
        }

        const onPropertyChanged = nodeType.prototype.onPropertyChanged;
        nodeType.prototype.onPropertyChanged = function (property, value) {
            if (property === "savedPoses") {
                this.jsonWidget.value = value;
            } else {
                if (onPropertyChanged)
                    onPropertyChanged.apply(this, arguments)
            }
        }
    }
});
