let response;
const AWS = require('aws-sdk')
const s3 = new AWS.S3()
const numbersBucket = 'everything-numbers';

const ELASTICSEARCH_URL = 'http://localhost:9200';
const { Client } = require('@elastic/elasticsearch')
const client = new Client({ node: ELASTICSEARCH_URL })

const chapterRegex =/^\d+\..*/
const formulaRegex=/^\d+.=.*/
const quotationRegex = /^[^\s]+.*\)$/
//const poemRegex = /\s+[^\d]*\)$/
const poemRegex = /\t[\s\S]*\)\n/
const levelRegex = /^Уровень.*|Уровень.*/
const ruleRegex=/Принцип:.*/
const regularRegex =/[\D].*/
const ruleFinish = /_+/
const resultRegex =/Уровень.*,/

const textParseRegex =/\D+|\d+/g
const numberRegex =/\d+/

//const allRegex=/^\d*\..*\n|\n\d*\..*\n|\d*.=.*\n|.*\)\n|^Уровень.*|\nУровень.*|\n\s+[^\d]*\)|Принцип:.*|_+|[\D].*/g
const allRegex=/^\d*\..*\n|\n\d*\..*\n|\d*.=.*\n|.*\)\n|^Уровень.*|\nУровень.*|\t[\s\S]*\)\n|Принцип:.*|_+|\w*.*\n/g

const LEVEL = 'level';
const CHAPTER = 'chapter';
const FORMULA = 'formula';
const RULE = 'rule';
const QUOTATION = 'quotation';
const POEM = 'poem';
const REGULAR = 'regular';
const RULE_BODY='rule body';
const RESULT = 'result';


function Record(type,spans,number){
    this.type = type;
    this.spans = spans;
    this.number = number === undefined ? -1 : number;
}

function Chapter(number,level){
    this.number = number;
    this.type = CHAPTER;
    this.level = level;
    this.records = [];

    this.addSpans = spans => this.records.push(new Record(CHAPTER,spans,this.number));
    this.addRecord = (type,spans)=>this.records.push(new Record(type,spans,this.number))
}


function put(params){
    return new Promise((resolve, reject) => {
        s3.putObject(params, function (err,res) {
            if(err){
                reject(err);
                return;
            }
            resolve(res);
        });
    })

}

const admin = require("firebase-admin");

const serviceAccount = require("../everything-book-firebase");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://everything-book.firebaseio.com"
});

const bookDao = admin.firestore().collection('book');
const ruleDao = admin.firestore().collection("rules");

async function elasticsearchCreate(chapter) {
    return client.index({
        id : chapter.number +'',
        index : 'book',
        body : chapter
    })
}

async function putChapter(chapter) {
    const key = chapter.number +'';
    const doc =bookDao.doc(key);
    const docRef = doc.get();
    const data = JSON.parse(JSON.stringify(chapter));
    return (await docRef).exists ? doc.update(data) : doc.create(data);
}

function putNumber(chapter){
    const params = {"Bucket": numbersBucket, "Key": chapter.number+'.json', "Body": JSON.stringify(chapter)};
    return put(params);
}

async function putChapters(chapters){
 //   await Promise.all(chapters.map(putNumber))
    await Promise.all(chapters.map(putChapter))
 //   await Promise.all(chapters.map(elasticsearchCreate))
}

exports.lambdaHandler = async (event, context) => {
    let currentLevel = -1;
    let currentChapter;
    const res = [];
    let levelRecord;
    let rule;
    async function processText(text) {
        let parsed;

        if(resultRegex.test(text)) {
            currentChapter.addRecord(RESULT,parseTextAndNumbers(text));
            return RESULT;
        }
        if(levelRegex.test(text)) {
            parsed =parseTextAndNumbers (text,num=>currentLevel=num);
            levelRecord = new Record(LEVEL,parsed);
            return LEVEL;
        }
        if(chapterRegex.test(text)){
            parsed = parseTextAndNumbers (text,num=>currentChapter = new Chapter(num,currentLevel));
            if(levelRecord){
                currentChapter.addRecord(LEVEL,levelRecord.spans);
                levelRecord = undefined;
            }
            currentChapter.addSpans(parsed);
            res.push(currentChapter);
            return CHAPTER;
        }
        if(formulaRegex.test(text)) {
            currentChapter.addRecord(FORMULA,parseTextAndNumbers(text));
            return FORMULA;
        }
        if(ruleRegex.test(text)){
            currentChapter.addRecord(RULE,parseTextAndNumbers(text));
            rule = [text];
            return RULE;
        }
        if(ruleFinish.test(text)){
            const doc = ruleDao.doc(rule[0]);
            const docRef = doc.get();
            const obj = {
                'rule':rule,
                'number': currentChapter.number};
            (await docRef).exists ? doc.update(obj) : doc.create(obj);
            rule = undefined;
            return RULE;
        }
        if(quotationRegex.test(text)) {
            currentChapter.addRecord(QUOTATION,parseTextAndNumbers(text));
            return QUOTATION;
        }
        if(poemRegex.test(text)) {
            currentChapter.addRecord(POEM,parseTextAndNumbers(text));
            return POEM;
        }

        if(rule && text){
            rule.push(text);
            currentChapter.addRecord(RULE_BODY,parseTextAndNumbers(text));
        }else {
            currentChapter.addRecord(REGULAR,parseTextAndNumbers(text));
        }

        return REGULAR;
    }

    function parseTextAndNumbers(str,onFirstNumberFound) {
        const res =[];
        let match;
        let shouldReactOnFound = !!onFirstNumberFound;
        do{
            match= textParseRegex.exec(str);
            if(match) {
                const text = match[0];
                const isNumber = numberRegex.test(text);
                res.push({
                    'number': isNumber,
                    'text':text
                });
                if(!isNumber || !shouldReactOnFound) continue;
                onFirstNumberFound(Number(text));
                shouldReactOnFound = false;
            }
        }while (match)

        return res;
    }

    try {
        const text = event.text;
        let match;
        do{
            match= allRegex.exec(text);

            if(match) {
                const text = poemRegex.test(match[0]) ? match[0] : match[0].trim();
                if(text){
                    await processText(text);
                }
            }
        }while (match);
        await putChapters(res);
        response = {
            'statusCode': 200,
            'body': JSON.stringify({'message':'ok'})
        }
    } catch (err) {
        console.log(err);
        return err;
    }

    return response
};

