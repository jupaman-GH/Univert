Quiero crear una aplicacion la cual su Frontend (UI) este desarrollado en HTML 5 (Css,js) y que se comunique con el backend que sea apropiado para las siguientes tareas:  


FUNCIONALIDADES:  
- Sera un conversor universal de Imagenes y Documentos  
- Permita convertir la mayoria de formatos de imagenes y documentos entre si  
- Tendra una seccion para convertir Imagenes donde se seleccionara un archivo de imagen, y a que formato de imagenes convertirlo  
- Tendra una seccion para convertir Documentos donde se seleccionara un archivo de tipo documento y a que formato de documento convertirlo  
- Las secciones Imagenes y Documentos estan por separado dado que cada una permitira agregar un archivo de la extension correspondiente  
- Permitira drag and drop a la aplicacion, la cual detectara que tipo de archivo es e ira a la seccion apropiada  
- Tendra un lugar donde mostrara la ruta origen desde donde se lee la imagen  
- Por defecto la aplicacion convierte en la misma ruta donde esta la imagen. Pero es posible habilitar un directorio distinto.  
- En seccion de imagenes deberia contemplar archivos de conversion vectorial (SVG)  
- Al convertir formato de imagen deberia de incluir segun el formato poder seleccionar la calidad de la imagen destino (0% a 100%)  
- Debera tener acceso a una seccion de conversion por lotes para multiples archivos:  
  - En la seccion de conversion por lotes permitira seleccionar si son imagenes o documentos, no se pueden agregar imagenes y documentos por lo que antes de seleccionar los archivos a agregar tengo que indicar si seran imagenes o documentos  
  - La seccion de conversion por lotes tiene 2 modalidades.  
 	1) Seleccionar varios archivos, elegir un formato de salida y se convierten todos al mismo formato seleccionado  
	2) Seleccionar varios archivos y habilitar por cada archivo agregado un formato especifico, al presionar en convertir convierte cada archivo al seleccionado individual para cada uno  
ENTORNO GRAFICO  
- La aplicacion debera tener un diseño agradable y futurista  
- Debera tener efectos de animacion e iluminacion de botones  
- Tendra la opcion de modificar transparencias, colores y efectos de blur para la ventana principal  
- Analizar archivo UIComponentes.md que posee rutas a diferentes tipos de objetos para utilizar en el UI.

USO Y DEPENDENCIAS:  
- La aplicacion debera tener todo lo necesario para realizar las conversiones. Al tenerla empaquetada que no requiera tener instalado algun software de tercero para poder convertir imagenes  o documentos.
- Si fuera necesario tener instalado en la pc local algun plugin o api para convertir algun formato, incluirlo en la aplicacion ya sea que pueda ejecutarse sin instalarse y si no hay otra solucion incluir el paquete a instalar en la misma aplicacion  
   
ANALISIS A REALIZAR  
- Evaluar que alternativa es mejor (Electron, tauri, nw.js, webview2). Para esto priorizar la disponibilidad de herramientas para UI e interfaces para la conversion de archivos.   
- Analizar que paquetes o codigo se puede utilizar para poder convertir la mayor cantidad de formatos y puntuar que formatos requeriran instalar librerias o APIs en la PC local y evaluar el mejor acercamiento para cumplir con la mayor cantidad de formatos posibles  
- Separar todo lo descripto en tareas o fases en un orden que se puedan ir implementando. Generar archivo Plan.md con todas las fases.