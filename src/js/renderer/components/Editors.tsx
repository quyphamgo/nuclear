import * as React from "react";
import 'codemirror/addon/selection/active-line';
import { EditorConfiguration, fromTextArea, Doc, Position, Pass } from "codemirror";
import { ReactIDE } from "../../ReactIDE";
import { readFile, writeFileSync } from "fs";
import { parse, join, resolve } from "path";
import {Uranium} from '../../../../lib/uranium/dist/index';
import FSProvider from '../../../../lib/uranium/dist/filesystem/fs.js';
var u = new Uranium({fileSystem: new FSProvider()});
u.Plugins.load("typescript");

import { remote, NativeImage, nativeImage } from 'electron';

for (var mode of ['javascript', 'xml', 'jsx', 'css', 'markdown']) {
    require('codemirror/mode/' + mode + '/' + mode);
}

var {TouchBar} = remote;


var debounce = function (func, wait, immediate?) {
    var timeout;
    return function (...args) {
        var context = this;
        var later = function () {
            timeout = null;
            if (!immediate) func.apply(context, args);
        };
        var callNow = immediate && !timeout;
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
        if (callNow) func.apply(context, args);
    };
};

export class Editors extends React.Component<{}, { files: string[], active: number, completions: any[], completionFocus: number }> {
    private _editorElement: HTMLTextAreaElement;
    private _codemirror;
    private isSaving;
    private docs: { [filename: string]: Doc } = {};
    private _completionElement: HTMLUListElement;
    private touchBarCompletions = new TouchBar.TouchBarSegmentedControl({segments: [], change: (i) => {
        var d = this._codemirror.getDoc();
        var line = d.getCursor().line;
        var pos = this._codemirror.getTokenAt(d.getCursor());
        // console.log({linepos.start});
        d.replaceRange(this.state.completions[i], {ch: pos.start, line}, {ch: pos.end, line});
        this.setState({completions: []});
        this.touchBarCompletions.segments = [];
    }})
    mainTouchbar = new TouchBar({items: [
        this.touchBarCompletions
    ]});

    constructor(props) {
        super(props);
        this.state = {
            files: [],
            completions: [],
            active: -1,
            completionFocus: 0
        }
        remote.BrowserWindow.getFocusedWindow().setTouchBar(this.mainTouchbar);
    }

    render() {
        return (
            <div style={{ position: 'relative' }}>
                <textarea ref={e => this._editorElement = e} style={{ height: '80%' }}></textarea>
                <ul ref={e => this._completionElement = e} style={{ height: 100, width: 'auto', padding: 5, display: this.state.completions.length > 0 ? 'block' : 'none', background: 'gray', position: 'absolute', zIndex: 1000, overflow: 'scroll' }}>
                    {this.state.completions.map((completion, key) => <li key={key} style={{ color: this.state.completionFocus == key ? 'white' : 'blue' }}>{completion}</li>)}
                </ul>
            </div>
        );
    }

    componentDidMount() {
        var c = window['cm'] = this._codemirror = fromTextArea(this._editorElement, {
            lineNumbers: true,
            styleActiveLine: true
        } as EditorConfiguration);
        c.setSize("100%", "80%");
        var complete = debounce(this._complete.bind(this), 100);
        var updateFile = debounce(this._updateFile.bind(this), 500);

        // var onChange = debounce(this.props.onChange, 500);
        c.on('change', (e, change) => {
            // console.log(change);
            if(change.origin && change.origin.charAt(0) == '+') {

                // ReactIDE.CompletionProviders.get().change(this.state.files[this.state.active], c.getDoc().getValue());

                var rect = this._editorElement.nextElementSibling.getBoundingClientRect();
                var cur = c.getDoc().getCursor();
                let { left, top } = c.cursorCoords(true);
                this._completionElement.style.left = (left - rect.left) + 'px';
                this._completionElement.style.top = (top - rect.top) + 'px';
                var token = c.getTokenAt(cur);
                var index = c.getDoc().indexFromPos(cur);
                // updateFile(this.state.files[this.state.active], c.getDoc().getValue());
                if(/[a-zA-Z]+/.test(change.text[0])) {
                    complete(c.getDoc().indexFromPos(cur), token.string);
                } else {
                    this.setState({completions: []});
                    this.touchBarCompletions.segments = [];
                }
            }
        });
        c.on('cursorActivity', () => {
            this.setState({completions: []});
            this.touchBarCompletions.segments = [];
        });

        c.on('scroll', (e) => {
            var rect = this._editorElement.nextElementSibling.getBoundingClientRect();
            let { left, top } = c.cursorCoords(true);
            this._completionElement.style.top = (top - rect.top) + 'px';
        });

        c.setOption("extraKeys", {
            "Up": () => {
                if (this.state.completions.length == 0) // logic to decide whether to move up or not
                {
                    return Pass;
                } else {
                    var newIndex = this.state.completionFocus > 0 ? this.state.completionFocus - 1 : 0;
                    this.touchBarCompletions.selectedIndex = newIndex;
                    this.setState({ completionFocus: newIndex });
                }
            },
            "Down": () => {
                if (this.state.completions.length == 0) // logic to decide whether to move up or not
                {
                    return Pass;
                } else {
                    var newIndex = this.state.completionFocus < this.state.completions.length - 1 ? this.state.completionFocus + 1 : this.state.completions.length - 1;
                    this.touchBarCompletions.selectedIndex = newIndex;
                    this.setState({ completionFocus:  newIndex});
                }
            },
            "Enter": () => {
                if(this.state.completions.length == 0) {
                    return Pass;
                } else {
                    var d = c.getDoc();
                    var line = d.getCursor().line;
                    var pos = c.getTokenAt(d.getCursor());
                    // console.log({linepos.start});
                    d.replaceRange(this.state.completions[this.state.completionFocus], {ch: pos.start, line}, {ch: pos.end, line});
                    this.setState({completions: []});
                    this.touchBarCompletions.segments = [];
                }
            },

            "Alt-LeftClick": (e, pos) => {
                // var definitions = ReactIDE.CompletionProviders.get().definition(this.state.files[this.state.active], c.getDoc().indexFromPos(pos));
                // if(definitions) {
                //     console.log(definitions);
                //     // c.getDoc().setCursor(c.getDoc().posFromIndex(definitions[0].textSpan.start));
                //     if(definitions[0].fileName != this.state.files[this.state.active]) {
                //         ReactIDE.Editor.open(definitions[0].fileName, definitions[0].textSpan.start);
                //     } else {
                //         c.getDoc().setCursor(c.getDoc().posFromIndex(definitions[0].textSpan.start));
                //     }
                // }
            }
        });


        ReactIDE.Editor.on('open', (file, index) => {
            var { files, active } = this.state;
            let i;
            if((i = files.indexOf(file)) > -1) {
                ReactIDE.Editor.focus(file);
                return;
            }
            active = files.length;
            files.push(file);
            this.docs[file] = Doc('', ReactIDE.FileTypes.getForFile(parse(file).base));
            c.swapDoc(this.docs[file]);
            u.Plugins.getCompleters()[0].openFile(file);
            readFile(files[active], 'utf8', (error, file) => {
                c.setValue(file);
                c.focus();
                if(index) {
                    c.getDoc().setCursor(c.getDoc().posFromIndex(index));
                }
            });
            this.setState({ files, active });
        });
        ReactIDE.Editor.on('close', (file) => {
            delete this.docs[file];
        });
        ReactIDE.Editor.on('focus', (filePath) => {
            if (filePath) {
                if (this.docs[filePath]) {
                    c.swapDoc(this.docs[filePath]);
                    this.setState({active: this.state.files.indexOf(filePath)});
                } else {
                    throw new Error("File not found");
                }
            } else {
                c.swapDoc(Doc('', 'text/plain'));
            }
        });
        ReactIDE.Editor.on('save', () => {
            // this.isSaving = true;
            writeFileSync(this.state.files[this.state.active], c.getValue());
            // onChange(false);
            // setTimeout(() => {
            //     this.isSaving = false;
            // }, 2000);
        });
        // ReactIDE.Editor.on('externalChange', (type, filePath) => {
        //     console.log(this.isSaving);
        //     if (filePath == this.props.files[this.props.active] && !this.isSaving) {
        //         if (confirm('The file has changed, load changes?')) {
        //             readFile(this.props.files[this.props.active], 'utf8', (error, file) => {
        //                 c.setValue(file);
        //             });
        //         }
        //     }
        // })
    }

    private _complete(position: number, token) {
        u.Plugins.getCompleters()[0].getCompletions(this.state.files[this.state.active], {offset: position}).then((list) => {
            list = list.filter(({name}) => name.slice(0, token.length) == token);
            console.log(list);
            var items = list.map((val): Electron.SegmentedControlSegment => {
                // var n = nativeImage.createFromPath(join(__dirname,'../../../../keyword.png'));
                // console.log(n);
                return {
                    label: val.name,
                    // icon: n
                };
            });
            this.touchBarCompletions.selectedIndex = 0;
            this.touchBarCompletions.segments = items;
            this.setState({ completions: list.map(({name})=>name), completionFocus: 0 });
        });
        // ReactIDE.CompletionProviders.get().getAtPosition(position, token, this.state.files[this.state.active], ;
    }
    private _updateFile(filePath, source) {
       
    }
}