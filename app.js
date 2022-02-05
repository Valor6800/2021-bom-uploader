const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');

require('dotenv').config();

const app = express();
const port = process.env.PORT;

var ValorBOM = require('./src/ValorBOM.js');
var bom = new ValorBOM();

app.use(express.static('dist'));
app.use(bodyParser.json());

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname + '/index.html'));
    bom.syncEpics();
});

app.get('/api/epics', (req, res) => {
    bom.getEpics(function(results) {
        this.send(results);
    }.bind(res));
});

app.get('/api/stories', (req, res) => {
    if (req.query.key) {
        bom.getStoriesByEpic(req.query.key, function(results) {
            this.send(results);
        }.bind(res));
    } else if (req.query.partNumber) {
        bom.getStoriesByPartNumber(req.query.partNumber, function(results) {
            this.send(results);
        }.bind(res));
    }
});

app.post('/api/stories', (req, res) => {
    let partNumber = req.body.summary.substring(
        req.body.summary.indexOf("[") + 1, 
        req.body.summary.lastIndexOf("]")
    );
    bom.postStory(req.body, function(results) {
	   this.res.send({key: results.key, partNumber: this.partNumber});
    }.bind({res: res, partNumber: partNumber}));
});

app.put('/api/stories', (req, res) => {
    let partNumber = req.body.summary.substring(
        req.body.summary.indexOf("[") + 1, 
        req.body.summary.lastIndexOf("]")
    );
    bom.putStory(req.query.key, req.body, function() {
        this.res.send(this.partNumber);
    }.bind({res: res, partNumber: partNumber}));
});

app.get('/api/bom', (req, res) => {
    bom.getBOM(req.query.documentId, req.query.workspaceId, req.query.elementId, function(results) {
        this.send(results);
    }.bind(res));
});

app.listen(port, () => {
  console.log(`Example app listening at http://localhost:${port}`)
});

// bom.getSTL('90aa6b11140a2aaa1358f517', '560f7cd006855516ae41d298', '30ad00ac248566286dc44b1f', 'JHD', function(results) {

// });
