let response;

const chapterRegex =/\d+\..*/
const formulaRegex=/\d+.=.*/
const quotationRegex = /^[^\s]+.*\)$/
const poemRegex = /\s+[^\d]*\)$/
const levelRegex = /^Уровень.*|Уровень.*/
const ruleRegex=/Принцип:.*/
const regularRegex =/[\D].*/

const allRegex=/^\d*\..*\n|\n\d*\..*\n|\d*.=.*\n|.*\)\n|^Уровень.*|\nУровень.*|\n\s+[^\d]*\)|Принцип:.*|[\D].*/g

exports.lambdaHandler = async (event, context) => {
    function getType(text) {
        if(levelRegex.test(text))
            return 'level';
        if(chapterRegex.test(text))
            return 'chapter';
        if(formulaRegex.test(text))
            return 'formula';
        if(ruleRegex.test(text))
            return 'rule';
        if(quotationRegex.test(text))
            return 'quotation';
        if(poemRegex.test(text))
            return 'poem';
        return 'regular'
    }

    try {
        const text = event.text;
        const res = [];
        let match;
        do{
            match= allRegex.exec(text);
            if(match) {
                const text = match[0].trim();
                res.push({
                    'type': getType(text),
                    'text':text
                });
            }
        }while (match)
        console.log(res);
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

